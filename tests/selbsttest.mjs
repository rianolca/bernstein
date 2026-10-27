// Selbsttest ohne Internet: ersetzt fetch() durch nachgebaute API-Antworten
// (Aufbau wie bei BSH und Open-Meteo) und lässt den ganzen Job einmal laufen.
//   node tests/selbsttest.mjs

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const STUNDE = 3600 * 1000;
const jetzt = Date.now();
const runde = (t) => Math.floor(t / STUNDE) * STUNDE;
const tmp = process.env.TEST_OUT || (await mkdtemp(path.join(os.tmpdir(), 'bernstein-')));
process.env.SITE_DIR = path.join(tmp, 'site');
process.env.STATE_DIR = path.join(tmp, 'state');
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = '42';
process.env.SEITEN_URL = 'https://beispiel.github.io/bernstein-alarm/';

const bshZeit = (t) => new Date(t).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00:00');

// Gezeiten: HW alle 12 h 25 min, NW 6 h 12 min danach
function station(id, name, lat, lon, sturmflutCm) {
  const mhw = 650, mnw = 350;
  const erstesHw = runde(jetzt) - 20 * STUNDE; // Sturmflut-Hochwasser vor 20 h
  const ereignisse = [];
  const kurve = [];
  for (let k = 0; k < 16; k++) {
    const hwT = erstesHw + k * 745 * 60 * 1000;
    const nwT = hwT + 372 * 60 * 1000;
    const zusatz = k === 0 ? sturmflutCm : k === 1 ? 40 : 0;
    if (hwT > jetzt - 3 * STUNDE) {
      ereignisse.push({ event_timestamp: bshZeit(hwT), event: 'HW', tidal_prediction_value: String(mhw + 10), forecast_value: k < 5 ? mhw + 10 + zusatz : null, forecast_deviation: '+0,1 m' });
      ereignisse.push({ event_timestamp: bshZeit(nwT), event: 'NW', tidal_prediction_value: String(mnw), forecast_value: null, forecast_deviation: '+/-0,0 m' });
    }
  }
  // Messkurve der letzten 30 h (Sinus, erstes HW erhöht)
  for (let t = runde(jetzt) - 30 * STUNDE; t <= jetzt; t += 15 * 60 * 1000) {
    const phase = ((t - erstesHw) / (745 * 60 * 1000)) * 2 * Math.PI;
    const naheSturm = Math.abs(t - erstesHw) < 4 * STUNDE ? sturmflutCm * Math.cos(((t - erstesHw) / (4 * STUNDE)) * (Math.PI / 2)) : 0;
    kurve.push({ timestamp: bshZeit(t), measurement: String(Math.round(500 + 150 * Math.cos(phase) + naheSturm)) });
  }
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { gauge_label: name, area: 'Elbe', forecast_timestamp: bshZeit(jetzt - STUNDE), mean_high_water: mhw, mean_low_water: mnw, high_water_low_water: ereignisse, curve: kurve },
  };
}

const bsh = {
  type: 'FeatureCollection',
  features: [
    station('cuxhaven_steubenhoeft', 'Cuxhaven, Steubenhöft', 53.8675, 8.7173, 130),
    station('buesum_schleuse', 'Büsum', 54.12, 8.858, 20),
    { type: 'Feature', id: 'flensburg', geometry: { type: 'Point', coordinates: [9.43, 54.79] }, properties: { gauge_label: 'Flensburg', area: 'Kieler Bucht', high_water_low_water: [] } },
  ],
  links: [],
};

function wetterAntwort() {
  const start = Math.floor((runde(jetzt) - 6 * 24 * STUNDE) / 1000);
  const n = 14 * 24;
  const time = Array.from({ length: n }, (_, i) => start + i * 3600);
  const h = (i) => (time[i] * 1000 - jetzt) / STUNDE;
  return {
    hourly: {
      time,
      wind_speed_10m: time.map((_, i) => (h(i) > -40 && h(i) < -18 ? 19 : 4)),     // Sturm 8 Bft bis vor 18 h
      wind_direction_10m: time.map((_, i) => (h(i) < -18 ? 300 : 120)),            // erst WNW, dann ablandig OSO
      wind_gusts_10m: time.map((_, i) => (h(i) > -40 && h(i) < -18 ? 27 : 7)),
      visibility: time.map((_, i) => (h(i) > 30 && h(i) < 40 ? 400 : 20000)),     // Nebel morgen
      precipitation: time.map(() => 0),
      weather_code: time.map((_, i) => (h(i) > 30 && h(i) < 40 ? 45 : 2)),
      is_day: time.map((t) => { const std = new Date(t * 1000).getUTCHours(); return std >= 7 && std < 16 ? 1 : 0; }),
      temperature_2m: time.map(() => 9),
    },
  };
}
function wellenAntwort() {
  const start = Math.floor((runde(jetzt) - 24 * STUNDE) / 1000);
  const time = Array.from({ length: 9 * 24 }, (_, i) => start + i * 3600);
  return { hourly: { time, wave_height: time.map(() => 1.2), wave_direction: time.map(() => 290) } };
}

const telegramNachrichten = [];
globalThis.fetch = async (url, opt) => {
  url = String(url);
  const json = (d) => ({ ok: true, status: 200, json: async () => d });
  if (url.startsWith('https://gdi.bsh.de/')) return json(bsh);
  if (url.startsWith('https://api.open-meteo.com/')) {
    const anzahl = new URL(url).searchParams.get('latitude').split(',').length;
    return json(anzahl === 1 ? wetterAntwort() : Array.from({ length: anzahl }, wetterAntwort));
  }
  if (url.startsWith('https://marine-api.open-meteo.com/')) {
    const anzahl = new URL(url).searchParams.get('latitude').split(',').length;
    return json(anzahl === 1 ? wellenAntwort() : Array.from({ length: anzahl }, wellenAntwort));
  }
  if (url.startsWith('https://api.telegram.org/')) {
    telegramNachrichten.push(JSON.parse(opt.body).text);
    return json({ ok: true, result: {} });
  }
  throw new Error('Unerwarteter Abruf: ' + url);
};

await mkdir(process.env.STATE_DIR, { recursive: true });
const { main } = await import('../scripts/update.mjs');
const B = await import('../lib/bernstein.js');

// ---- Lauf 1 ----
await main();
const index = JSON.parse(await readFile(path.join(process.env.SITE_DIR, 'data', 'index.json'), 'utf8'));
assert.equal(index.stationen.length, 2, 'Ostsee-Pegel ohne Gezeiten muss fehlen');
const cux = index.stationen.find((s) => s.id === 'cuxhaven_steubenhoeft');
assert.ok(cux.beste && cux.beste.bewertung >= 0.75, `Cuxhaven sollte "sehr gut" sein, ist ${JSON.stringify(cux.beste)}`);

const historie = JSON.parse(await readFile(path.join(process.env.STATE_DIR, 'ereignisse.json'), 'utf8'));
assert.ok(historie.cuxhaven_steubenhoeft?.[0]?.abw >= 120, 'gemessene Sturmflut muss gemerkt werden');
assert.equal(historie.buesum_schleuse, undefined, 'Büsum hatte kein erhöhtes Hochwasser');

assert.equal(telegramNachrichten.length, 1 + 1, 'Cuxhaven (Sturmflut) und Büsum (Sturm) melden');
console.log('\n--- Telegram-Nachricht ---\n' + telegramNachrichten[0] + '\n--------------------------\n');

// ---- Lauf 2: nichts Neues -> keine doppelte Meldung ----
await main();
assert.equal(telegramNachrichten.length, 2, 'keine doppelte Meldung');

// ---- Bewertung im Detail ----
const s = JSON.parse(await readFile(path.join(process.env.SITE_DIR, 'data', 'stationen', 'cuxhaven_steubenhoeft.json'), 'utf8'));
const cfg = B.mischeKonfig(JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8')));
const erg = B.berechneStation(s, cfg, jetzt);
for (const f of erg.fenster.slice(0, 6)) {
  for (const x of [f.strand, f.watt].filter(Boolean)) {
    console.log(`${x.art.padEnd(6)} ${B.formatZeitpunkt(x.von)}–${B.formatZeit(x.bis)}  ${x.stufenName.padEnd(8)} ${String(x.bewertung).padEnd(5)} ${x.licht ?? ''}  ${x.warnungen.join('; ')}`);
  }
}
const nebelWatt = erg.fenster.flatMap((f) => [f.watt]).find((w) => w && w.warnungen.some((x) => x.startsWith('Nebel')));
assert.ok(nebelWatt, 'Nebel im Watt muss gewarnt werden');

// ---- Kleine Einzeltests ----
assert.equal(B.bft(19), 8);
assert.equal(B.bft(0.1), 0);
assert.equal(B.bftZuMs(7), 13.9);
assert.equal(B.istAuflandig(10, { von: 225, bis: 360 }), false);
assert.equal(B.istAuflandig(0, { von: 225, bis: 360 }), true);
assert.equal(B.istAuflandig(20, { von: 300, bis: 40 }), true);
assert.equal(B.cmAlsMeter(130), '+1,3 m');
assert.equal(B.abklingFaktor(24, cfg), 1);
assert.equal(B.abklingFaktor(48 + 36, cfg), 0.5);

console.log('\n✅ Selbsttest bestanden');
