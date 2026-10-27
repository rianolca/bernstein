// Stündlicher Job (läuft in GitHub Actions):
// 1. Wasserstände und Gezeiten vom BSH holen
// 2. Wetter und Wellen von Open-Meteo (DWD-Modelle) holen
// 3. Alles für die Web-App als JSON ablegen (Ordner _site/data)
// 4. Für deine Orte prüfen, ob es sich lohnt – und ggf. per Telegram melden

import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as B from '../lib/bernstein.js';
import { sendeNachricht, zeigeChatIds, telegramBereit } from './telegram.mjs';

const STUNDE = 3600 * 1000;
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.resolve(WURZEL, process.env.SITE_DIR || '_site');
const STATE = path.resolve(WURZEL, process.env.STATE_DIR || 'state');
const SEITEN_URL = process.env.SEITEN_URL || '';
const MODUS = process.env.MODUS || 'normal';

const BSH_URL = 'https://gdi.bsh.de/ldproxy/rest/services/WaterLevelForecast/collections/waterlevelforecastdata/items';
const WETTER_URL = 'https://api.open-meteo.com/v1/forecast';
const WELLEN_URL = 'https://marine-api.open-meteo.com/v1/marine';

// ---------------------------------------------------------------------------
// Abruf-Helfer
// ---------------------------------------------------------------------------
async function holeJson(url, versuche = 3) {
  let fehler;
  for (let i = 0; i < versuche; i++) {
    try {
      const antwort = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'bernstein-alarm (GitHub Actions)' } });
      if (!antwort.ok) throw new Error(`HTTP ${antwort.status} bei ${url.slice(0, 120)}`);
      return await antwort.json();
    } catch (e) {
      fehler = e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw fehler;
}

const zahl = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const zeit = (s) => (s ? Date.parse(String(s).replace(' ', 'T')) : NaN);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// "+0,3 m" -> 30 (cm)
function abweichungAusText(s) {
  if (s == null) return null;
  const n = zahl(String(s).replace('+/-', '').replace('+', '').replace(/\s*m\s*$/, ''));
  return n == null ? null : Math.round(n * 100);
}

// ---------------------------------------------------------------------------
// BSH: Pegel, Gezeiten, Vorhersagen, Messkurve
// ---------------------------------------------------------------------------
async function holeBsh() {
  const features = [];
  let url = `${BSH_URL}?f=json&limit=1000`;
  for (let seite = 0; seite < 20 && url; seite++) {
    const d = await holeJson(url);
    features.push(...(d.features || []));
    url = (d.links || []).find((l) => l.rel === 'next')?.href || null;
  }
  return features;
}

function koordinaten(geometrie) {
  if (!geometrie) return [null, null];
  let c = geometrie.coordinates;
  if (geometrie.type === 'MultiPoint') c = c?.[0];
  if (!Array.isArray(c) || c.length < 2) return [null, null];
  return [zahl(c[1]), zahl(c[0])]; // GeoJSON: [lon, lat]
}

// Gemessene Scheitel (Hochwasser) aus der Messkurve finden
function gemesseneScheitel(kurve, mhw, mnw) {
  const punkte = (kurve || [])
    .map((p) => ({ t: zeit(p.timestamp), w: zahl(p.measurement) }))
    .filter((p) => Number.isFinite(p.t) && p.w != null)
    .sort((a, b) => a.t - b.t);
  if (!punkte.length || mhw == null) return [];
  const mitte = mnw != null ? (mhw + mnw) / 2 : mhw - 150;
  const scheitel = [];
  for (let i = 0; i < punkte.length; i++) {
    const p = punkte[i];
    if (p.w < mitte) continue;
    let istMax = true;
    for (let j = i - 1; j >= 0 && p.t - punkte[j].t <= 3 * STUNDE; j--) if (punkte[j].w > p.w) { istMax = false; break; }
    for (let j = i + 1; istMax && j < punkte.length && punkte[j].t - p.t <= 3 * STUNDE; j++) if (punkte[j].w > p.w) istMax = false;
    // Scheitel am Rand der Kurve sind unsicher
    const amRand = p.t - punkte[0].t < 2 * STUNDE || punkte[punkte.length - 1].t - p.t < 2 * STUNDE;
    if (!istMax || amRand) continue;
    const letzter = scheitel[scheitel.length - 1];
    if (letzter && p.t - letzter.t < 4 * STUNDE) continue; // gleiches Hochwasser (Plateau)
    scheitel.push({ t: p.t, wert: p.w, abw: Math.round(p.w - mhw) });
  }
  return scheitel;
}

function normalisiereStation(f) {
  const p = f.properties || {};
  const ereignisse = p.high_water_low_water;
  if (!Array.isArray(ereignisse) || !ereignisse.length) return null; // ohne Gezeiten (z. B. Ostsee) überspringen
  const mhw = zahl(p.mean_high_water);
  const mnw = zahl(p.mean_low_water);
  const [lat, lon] = koordinaten(f.geometry);

  const tiden = ereignisse
    .map((e) => {
      const vorhersage = zahl(e.forecast_value);
      const wert = vorhersage ?? zahl(e.tidal_prediction_value);
      const bezug = e.event === 'HW' ? mhw : mnw;
      const abw = wert != null && bezug != null ? Math.round(wert - bezug) : abweichungAusText(e.forecast_deviation);
      return { t: zeit(e.event_timestamp), typ: e.event, wert, abw, quelle: vorhersage != null ? 'vorhersage' : 'gezeiten' };
    })
    .filter((e) => Number.isFinite(e.t) && (e.typ === 'HW' || e.typ === 'NW'))
    .sort((a, b) => a.t - b.t);

  return {
    id: String(f.id),
    name: p.gauge_label || String(f.id),
    gebiet: p.area || '',
    lat,
    lon,
    mhw,
    mnw,
    vorhersageVom: p.forecast_timestamp || p.automated_curveforecast_timestamp || null,
    tiden,
    gemessen: gemesseneScheitel(p.curve, mhw, mnw),
  };
}

// ---------------------------------------------------------------------------
// Open-Meteo: Wetter (Wind, Böen, Sicht/Nebel, Regen, Tag/Nacht) und Wellen
// ---------------------------------------------------------------------------
function zuReihe(hourly, felder) {
  if (!hourly || !hourly.time || hourly.time.length < 2) return null;
  const werte = {};
  for (const [name, quelle, runden] of felder) werte[name] = (hourly[quelle] || []).map((x) => (x == null ? null : runden ? runden(x) : x));
  return { start: hourly.time[0] * 1000, schritt: (hourly.time[1] - hourly.time[0]) * 1000, werte };
}

async function holeOpenMeteo(basis, stationen, parameter, felder) {
  const ergebnis = new Map();
  const mitKoord = stationen.filter((s) => s.lat != null && s.lon != null);
  for (let i = 0; i < mitKoord.length; i += 40) {
    const teil = mitKoord.slice(i, i + 40);
    const url = `${basis}?latitude=${teil.map((s) => s.lat.toFixed(4)).join(',')}&longitude=${teil.map((s) => s.lon.toFixed(4)).join(',')}&${parameter}&timeformat=unixtime&timezone=GMT`;
    let antwort = await holeJson(url);
    if (!Array.isArray(antwort)) antwort = [antwort];
    teil.forEach((s, j) => ergebnis.set(s.id, zuReihe(antwort[j]?.hourly, felder)));
  }
  return ergebnis;
}

const holeWetter = (stationen) =>
  holeOpenMeteo(
    WETTER_URL,
    stationen,
    'hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation,weather_code,is_day,temperature_2m&wind_speed_unit=ms&past_days=6&forecast_days=8',
    [
      ['wind', 'wind_speed_10m', r1],
      ['richtung', 'wind_direction_10m', Math.round],
      ['boeen', 'wind_gusts_10m', r1],
      ['sicht', 'visibility', (x) => Math.round(x / 10) * 10],
      ['regen', 'precipitation', r1],
      ['code', 'weather_code', null],
      ['tag', 'is_day', null],
      ['temp', 'temperature_2m', r1],
    ],
  );

const holeWellen = (stationen) =>
  holeOpenMeteo(WELLEN_URL, stationen, 'hourly=wave_height,wave_direction&past_days=1&forecast_days=8&cell_selection=sea', [
    ['hoehe', 'wave_height', r1],
    ['richtung', 'wave_direction', Math.round],
  ]);

// ---------------------------------------------------------------------------
// Gedächtnis zwischen den Läufen (Ordner state/, wird ins Repo committet)
// ---------------------------------------------------------------------------
async function leseJson(datei, standard) {
  try {
    return JSON.parse(await readFile(datei, 'utf8'));
  } catch {
    return standard;
  }
}

async function schreibeWennGeaendert(datei, daten) {
  const neu = JSON.stringify(daten, null, 1) + '\n';
  const alt = await readFile(datei, 'utf8').catch(() => null);
  if (alt !== neu) await writeFile(datei, neu);
}

// Vergangene erhöhte Hochwasser merken, damit die "Abklingzeit" über mehrere
// Tage funktioniert – die BSH-Messkurve reicht nicht so weit zurück.
function aktualisiereHistorie(historie, station, cfg, jetzt) {
  const ab = cfg.schwellen.ereignisAbCm;
  const liste = (historie[station.id] || []).filter((e) => jetzt - e.t < 10 * 24 * STUNDE);
  const neu = [
    ...station.gemessen.map((s) => ({ t: s.t, abw: s.abw, quelle: 'gemessen' })),
    ...station.tiden.filter((x) => x.typ === 'HW' && x.t < jetzt && x.quelle === 'vorhersage').map((x) => ({ t: x.t, abw: x.abw, quelle: 'vorhersage' })),
  ].filter((e) => e.abw != null && e.abw >= ab);
  for (const e of neu) {
    const i = liste.findIndex((x) => Math.abs(x.t - e.t) < 3 * STUNDE);
    if (i === -1) liste.push(e);
    else if (e.quelle === 'gemessen') liste[i] = e; // Messung ersetzt Vorhersage
  }
  liste.sort((a, b) => a.t - b.t);
  if (liste.length) historie[station.id] = liste;
  else delete historie[station.id];
  return liste;
}

// ---------------------------------------------------------------------------
// Telegram-Nachricht
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LICHT = { tag: '☀️ Tag', nacht: '🌙 Nacht/UV', gemischt: '🌗 Dämmerung' };

function fensterZeile(f) {
  const icon = f.art === 'strand' ? '🏖 Strand' : '🦶 Watt';
  const teile = [`${B.formatTag(f.von)} ${B.formatZeit(f.von)}–${B.formatZeit(f.bis)}`, LICHT[f.licht] || '', `<b>${esc(f.stufenName)}</b>`];
  const w = f.wetter;
  if (w.windBft != null) teile.push(`Wind ${w.windBft} Bft ${B.richtungName(w.richtung)}`);
  if (w.sichtMin != null && w.sichtMin < 1000) teile.push('⚠️ Nebel');
  return `${icon}: ${teile.filter(Boolean).join(' · ')}`; // enthält bewusst HTML (<b>)
}

function nachricht(station, ort, kandidaten, treiber) {
  const name = ort?.name || station.name;
  const zeilen = [`🟠 <b>Bernstein-Alarm: ${esc(name)}</b>`];
  if (treiber) zeilen.push(`${esc(B.ereignisText(treiber))} – ${B.formatZeitpunkt(treiber.t)}`);
  zeilen.push('', 'Beste Zeitfenster:');
  for (const f of kandidaten.slice(0, 5)) zeilen.push(fensterZeile(f));
  const warn = [...new Set(kandidaten.slice(0, 5).flatMap((f) => f.warnungen))];
  if (warn.length) zeilen.push('', ...warn.map((x) => `⚠️ ${esc(x)}`));
  if (SEITEN_URL) zeilen.push('', `<a href="${SEITEN_URL}#${encodeURIComponent(station.id)}">Details in der Web-App</a>`);
  return zeilen.join('\n');
}

async function benachrichtige(stationen, cfg, jetzt, gemerkt) {
  const bis = jetzt + cfg.benachrichtigung.vorlaufTage * 24 * STUNDE;
  for (const ort of cfg.orte) {
    const station = stationen.find((s) => s.id === ort.station);
    if (!station) {
      console.warn(`⚠️  Ort "${ort.name || ort.station}": Pegel "${ort.station}" nicht gefunden. Stimmt die Kennung in config.json?`);
      continue;
    }
    const { fenster } = B.berechneStation(station, cfg, jetzt);
    const kandidaten = fenster
      .flatMap((x) => [x.strand, x.watt])
      .filter((f) => f && f.bis > jetzt && f.von < bis && f.bewertung >= cfg.benachrichtigung.abBewertung)
      .sort((a, b) => a.von - b.von);
    if (!kandidaten.length) continue;

    const bester = kandidaten.reduce((a, b) => (b.bewertung > a.bewertung ? b : a));
    const treiber = bester.treiber;
    const schluessel = `${station.id}|${treiber ? `${treiber.typ}@${Math.round(treiber.t / STUNDE)}` : 'ohne'}`;
    const vorher = gemerkt[schluessel];
    if (vorher && B.stufenRang(vorher.stufe) >= B.stufenRang(bester.stufe)) continue; // schon gemeldet

    const text = nachricht(station, ort, kandidaten, treiber);
    if (await sendeNachricht(text)) console.log(`📨 Telegram gesendet für ${station.name}`);
    gemerkt[schluessel] = { stufe: bester.stufe, am: jetzt };
  }
  for (const [k, v] of Object.entries(gemerkt)) if (jetzt - v.am > 14 * 24 * STUNDE) delete gemerkt[k];
}

// ---------------------------------------------------------------------------
// Hauptablauf
// ---------------------------------------------------------------------------
export async function main() {
  const jetzt = Date.now();
  let cfgDatei;
  try {
    cfgDatei = JSON.parse(await readFile(path.join(WURZEL, 'config.json'), 'utf8'));
  } catch (e) {
    throw new Error(`config.json ist kein gültiges JSON (fehlt ein Komma oder eine Klammer?): ${e.message}`);
  }
  const cfg = B.mischeKonfig(cfgDatei);

  if (MODUS === 'chat-id-anzeigen') await zeigeChatIds();
  if (MODUS === 'telegram-test') {
    const ok = await sendeNachricht('✅ Bernstein-Alarm: Telegram ist richtig eingerichtet.' + (SEITEN_URL ? `\n${SEITEN_URL}` : ''));
    console.log(ok ? 'Testnachricht gesendet.' : 'Testnachricht nicht gesendet (Secrets fehlen).');
  }

  console.log('Hole BSH-Daten …');
  const stationen = (await holeBsh()).map(normalisiereStation).filter(Boolean);
  console.log(`${stationen.length} Pegel mit Gezeiten gefunden.`);

  console.log('Hole Wetter und Wellen …');
  const [wetter, wellen] = await Promise.all([
    holeWetter(stationen).catch((e) => (console.warn('Wetter fehlgeschlagen:', e.message), new Map())),
    holeWellen(stationen).catch((e) => (console.warn('Wellen fehlgeschlagen:', e.message), new Map())),
  ]);

  await mkdir(STATE, { recursive: true });
  const historie = await leseJson(path.join(STATE, 'ereignisse.json'), {});
  const gemerkt = await leseJson(path.join(STATE, 'benachrichtigt.json'), {});

  for (const s of stationen) {
    s.wetter = wetter.get(s.id) || null;
    s.wellen = wellen.get(s.id) || null;
    s.historie = aktualisiereHistorie(historie, s, cfg, jetzt);
  }

  // Web-App bauen: statische Dateien + Daten
  await rm(SITE, { recursive: true, force: true });
  await mkdir(path.join(SITE, 'data', 'stationen'), { recursive: true });
  for (const datei of ['index.html', 'app.js', 'style.css', 'config.json', 'lib']) {
    await cp(path.join(WURZEL, datei), path.join(SITE, datei), { recursive: true });
  }

  const index = [];
  for (const s of stationen) {
    await writeFile(path.join(SITE, 'data', 'stationen', `${s.id}.json`), JSON.stringify(s));
    const { beste, ereignisse } = B.berechneStation(s, cfg, jetzt);
    const letztesHw = [...ereignisse].reverse().find((e) => e.typ === 'hochwasser' && e.t <= jetzt + 24 * STUNDE);
    index.push({
      id: s.id,
      name: s.name,
      gebiet: s.gebiet,
      lat: s.lat,
      lon: s.lon,
      beste: beste ? { bewertung: beste.bewertung, stufe: beste.stufe, art: beste.art, von: beste.von } : null,
      hochwasser: letztesHw ? { t: letztesHw.t, abw: letztesHw.abw } : null,
    });
  }
  await writeFile(path.join(SITE, 'data', 'index.json'), JSON.stringify({ erstellt: jetzt, stationen: index }));
  console.log(`Web-App mit ${index.length} Pegeln gebaut.`);

  if (!telegramBereit()) console.log('Hinweis: Telegram-Secrets fehlen – es werden keine Nachrichten verschickt.');
  await benachrichtige(stationen, cfg, jetzt, gemerkt);

  await schreibeWennGeaendert(path.join(STATE, 'ereignisse.json'), historie);
  await schreibeWennGeaendert(path.join(STATE, 'benachrichtigt.json'), gemerkt);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('❌ Fehler:', e);
    process.exit(1);
  });
}
