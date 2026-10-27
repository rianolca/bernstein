// Bernstein-Alarm – Web-App
// Liest die vom GitHub-Job erzeugten Daten und rechnet die Zeitfenster
// mit derselben Logik (lib/bernstein.js) im Browser aus.

import * as B from './lib/bernstein.js';

const STUNDE = 3600 * 1000;
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const normal = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();

const zustand = {
  cfg: null,
  stationen: [],
  karte: null,
  pins: new Map(),
  aktiv: null,
  nurLohnend: false,
  cache: new Map(),
};

try {
  zustand.nurLohnend = localStorage.getItem('nurLohnend') === '1';
} catch {}

const LICHT = { tag: 'Tag', nacht: 'Nacht, UV-Lampe', gemischt: 'Dämmerung' };
const ART = { strand: 'Strand', watt: 'Watt' };

// ---------------------------------------------------------------------------
async function start() {
  let cfgRoh, index;
  try {
    [cfgRoh, index] = await Promise.all([ladeJson('config.json'), ladeJson('data/index.json')]);
  } catch (e) {
    $('#inhalt').innerHTML = `<p class="fehler">Noch keine Daten gefunden. Der GitHub-Job muss mindestens einmal erfolgreich gelaufen sein (Reiter „Actions“ im Repository).</p>`;
    console.error(e);
    return;
  }
  zustand.cfg = B.mischeKonfig(cfgRoh);
  zustand.stationen = index.stationen;
  $('#datenstand').textContent = `Daten von ${B.formatZeitpunkt(index.erstellt)} Uhr, stündlich aktualisiert`;

  baueKarte();
  baueMeineOrte();
  baueSuche();

  window.addEventListener('hashchange', () => waehleAusHash());
  if (!waehleAusHash()) {
    const erster = zustand.cfg.orte.find((o) => zustand.stationen.some((s) => s.id === o.station));
    if (erster) waehle(erster.station, { hash: false });
  }
}

async function ladeJson(url) {
  const antwort = await fetch(url, { cache: 'no-cache' });
  if (!antwort.ok) throw new Error(`${url}: HTTP ${antwort.status}`);
  return antwort.json();
}

function waehleAusHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id && zustand.stationen.some((s) => s.id === id)) {
    waehle(id, { hash: false });
    return true;
  }
  return false;
}

const istMeinOrt = (id) => zustand.cfg.orte.some((o) => o.station === id);
const anzeigeName = (s) => B.ortFuer(s.id, zustand.cfg)?.name || s.name;

// ---------------------------------------------------------------------------
// Karte
// ---------------------------------------------------------------------------
function baueKarte() {
  const karte = L.map('karte', { zoomControl: true }).setView([54.0, 8.4], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 15,
    attribution: '© OpenStreetMap',
  }).addTo(karte);

  const grenzen = [];
  for (const s of zustand.stationen) {
    if (s.lat == null || s.lon == null) continue;
    const stufeName = s.beste?.stufe || 'keine';
    const pin = L.circleMarker([s.lat, s.lon], {
      radius: istMeinOrt(s.id) ? 9 : 6,
      className: `pin pin--${stufeName}${istMeinOrt(s.id) ? ' pin--mein' : ''}`,
    })
      .addTo(karte)
      .bindTooltip(`${esc(anzeigeName(s))}${s.beste && s.beste.stufe !== 'keine' ? ` – ${esc(B.stufe(s.beste.bewertung).name)}` : ''}`)
      .on('click', () => waehle(s.id));
    zustand.pins.set(s.id, pin);
    grenzen.push([s.lat, s.lon]);
  }
  if (grenzen.length) karte.fitBounds(grenzen, { padding: [30, 30], maxZoom: 9 });
  zustand.karte = karte;
}

function markiereAktivenPin(id) {
  for (const [sid, pin] of zustand.pins) {
    const el = pin.getElement();
    if (el) el.classList.toggle('pin--aktiv', sid === id);
    if (sid === id) pin.bringToFront();
  }
}

// ---------------------------------------------------------------------------
// Meine Orte und Suche
// ---------------------------------------------------------------------------
function baueMeineOrte() {
  const nav = $('#meine-orte');
  nav.innerHTML = '';
  for (const ort of zustand.cfg.orte) {
    const s = zustand.stationen.find((x) => x.id === ort.station);
    if (!s) continue;
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.dataset.id = s.id;
    knopf.innerHTML = `<i class="perle" data-stufe="${esc(s.beste?.stufe || 'keine')}"></i>${esc(ort.name || s.name)}`;
    knopf.addEventListener('click', () => waehle(s.id));
    nav.append(knopf);
  }
}

function baueSuche() {
  const feld = $('#suchfeld');
  const liste = $('#treffer');
  let treffer = [];
  let auswahl = -1;

  const zeige = () => {
    const q = normal(feld.value);
    if (!q) {
      liste.hidden = true;
      feld.setAttribute('aria-expanded', 'false');
      return;
    }
    treffer = zustand.stationen
      .filter((s) => normal(`${s.name} ${s.gebiet} ${s.id} ${anzeigeName(s)}`).includes(q))
      .slice(0, 10);
    auswahl = treffer.length ? 0 : -1;
    liste.innerHTML = treffer.length
      ? treffer
          .map(
            (s, i) =>
              `<li role="option" id="treffer-${i}" data-id="${esc(s.id)}" aria-selected="${i === auswahl}"><i class="perle" data-stufe="${esc(s.beste?.stufe || 'keine')}"></i>${esc(s.name)}<small>${esc(s.gebiet)}</small></li>`,
          )
          .join('')
      : '<li aria-disabled="true">Kein Pegel gefunden</li>';
    liste.hidden = false;
    feld.setAttribute('aria-expanded', 'true');
  };

  const markiere = () => {
    [...liste.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === auswahl)));
    if (auswahl >= 0) feld.setAttribute('aria-activedescendant', `treffer-${auswahl}`);
  };

  const uebernehme = (id) => {
    feld.value = '';
    liste.hidden = true;
    feld.setAttribute('aria-expanded', 'false');
    waehle(id);
  };

  feld.addEventListener('input', zeige);
  feld.addEventListener('keydown', (e) => {
    if (liste.hidden || !treffer.length) return;
    if (e.key === 'ArrowDown') { auswahl = (auswahl + 1) % treffer.length; markiere(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { auswahl = (auswahl - 1 + treffer.length) % treffer.length; markiere(); e.preventDefault(); }
    else if (e.key === 'Enter' && auswahl >= 0) { uebernehme(treffer[auswahl].id); e.preventDefault(); }
    else if (e.key === 'Escape') { liste.hidden = true; feld.setAttribute('aria-expanded', 'false'); }
  });
  liste.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) uebernehme(li.dataset.id);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.suche')) liste.hidden = true;
  });
}

// ---------------------------------------------------------------------------
// Station anzeigen
// ---------------------------------------------------------------------------
async function waehle(id, { hash = true } = {}) {
  zustand.aktiv = id;
  if (hash && location.hash !== `#${id}`) history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  document.querySelectorAll('#meine-orte button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.id === id)));
  markiereAktivenPin(id);

  const eintrag = zustand.stationen.find((s) => s.id === id);
  if (eintrag?.lat != null && zustand.karte) zustand.karte.flyTo([eintrag.lat, eintrag.lon], Math.max(zustand.karte.getZoom(), 9), { duration: 0.6 });

  const inhalt = $('#inhalt');
  try {
    let station = zustand.cache.get(id);
    if (!station) {
      inhalt.innerHTML = '<p class="leer">Lade Daten …</p>';
      station = await ladeJson(`data/stationen/${encodeURIComponent(id)}.json`);
      zustand.cache.set(id, station);
    }
    if (zustand.aktiv !== id) return;
    zeichne(station);
  } catch (e) {
    inhalt.innerHTML = `<p class="fehler">Daten für diesen Pegel konnten nicht geladen werden (${esc(e.message)}).</p>`;
  }
}

function zeichne(station) {
  const jetzt = Date.now();
  const cfg = zustand.cfg;
  const { ereignisse, fenster, beste } = B.berechneStation(station, cfg, jetzt);
  const ort = B.ortFuer(station.id, cfg);
  const sektor = B.sektorFuer(station.id, cfg);

  const teile = [];
  teile.push(`<header class="station-kopf">
    <h2>${esc(ort?.name || station.name)}</h2>
    <p>Pegel ${esc(station.name)}, ${esc(station.gebiet)}. Auflandig zählt Wind aus ${B.richtungName(sektor.von)} bis ${B.richtungName(sektor.bis)}.</p>
    <p>Kennung für config.json: <code>${esc(station.id)}</code></p>
  </header>`);

  // Fazit
  if (beste && beste.bewertung > 0) {
    teile.push(`<div class="fazit"><i class="perle" data-stufe="${beste.stufe}"></i><p>Beste Chance in den nächsten Tagen: <strong>${esc(ART[beste.art])} ${B.formatTag(beste.von)}, ${B.formatZeit(beste.von)}–${B.formatZeit(beste.bis)} Uhr</strong>, ${esc(beste.stufenName)}.</p></div>`);
  } else {
    teile.push(`<div class="fazit"><i class="perle" data-stufe="keine"></i><p>Zurzeit kein erhöhtes Hochwasser und kein auflandiger Sturm – die Chancen sind normal bis gering.</p></div>`);
  }

  // Ereignisse
  const relevant = ereignisse.filter((e) => e.t > jetzt - 6 * 24 * STUNDE);
  if (relevant.length) {
    teile.push(`<section class="ereignisse"><h3>Ereignisse</h3><ul>${relevant
      .map((e) => {
        const erwartet = e.t > jetzt;
        return `<li class="${erwartet ? 'erwartet' : ''}"><time>${erwartet ? 'erwartet ' : ''}${B.formatZeitpunkt(e.t)} Uhr</time>${esc(B.ereignisText(e))}</li>`;
      })
      .join('')}</ul></section>`);
  }

  // Filter
  teile.push(`<label class="filter"><input type="checkbox" id="nur-lohnend" ${zustand.nurLohnend ? 'checked' : ''}> Nur Fenster ab „mittel“ zeigen</label>`);

  // Zeitfenster nach Tagen
  const tage = new Map();
  for (const f of fenster) {
    const fenListe = [f.strand, f.watt].filter(Boolean);
    if (!fenListe.some((x) => x.bis > jetzt)) continue;
    if (zustand.nurLohnend && !fenListe.some((x) => x.bewertung >= 0.25 && x.bis > jetzt)) continue;
    const k = B.tagSchluessel(f.hw.t);
    if (!tage.has(k)) tage.set(k, []);
    tage.get(k).push(f);
  }

  if (!tage.size) {
    teile.push(`<p class="leer">${zustand.nurLohnend ? 'In den nächsten Tagen ist kein Fenster mindestens „mittel“.' : 'Keine Gezeitendaten für die nächsten Tage.'}</p>`);
  }
  for (const liste of tage.values()) {
    teile.push(`<section class="tag"><h3>${B.formatTag(liste[0].hw.t)}</h3>${liste.map((f) => tide(f, jetzt)).join('')}</section>`);
  }

  $('#inhalt').innerHTML = teile.join('');
  $('#nur-lohnend').addEventListener('change', (e) => {
    zustand.nurLohnend = e.target.checked;
    try { localStorage.setItem('nurLohnend', zustand.nurLohnend ? '1' : '0'); } catch {}
    zeichne(station);
  });
}

function tide(f, jetzt) {
  const { hw, nw } = f;
  const erhoeht = hw.abw != null && hw.abw >= zustand.cfg.schwellen.ereignisAbCm;
  const quelle = hw.quelle === 'vorhersage' ? 'Vorhersage' : 'Gezeiten';
  let zeile = `<b>Hochwasser ${B.formatZeit(hw.t)}</b> <span class="${erhoeht ? 'erhoeht' : ''}">${B.cmAlsMeter(hw.abw)} über MHW</span> (${quelle})`;
  if (nw) zeile += `, Niedrigwasser ${B.formatZeit(nw.t)} (${B.cmAlsMeter(nw.abw)})`;
  const fenListe = [f.strand, f.watt].filter(Boolean).filter((x) => !(zustand.nurLohnend && x.bewertung < 0.25));
  return `<div class="tide"><p class="tide-zeile">${zeile}</p>${fenListe.map((x) => fensterHtml(x, jetzt)).join('')}</div>`;
}

function fensterHtml(f, jetzt) {
  const w = f.wetter;
  const daten = [];
  if (w.windBft != null) daten.push(`Wind ${w.windBft} Bft aus ${B.richtungName(w.richtung)}${w.auflandig ? ', auflandig' : ''}`);
  if (w.boeenBft != null && w.boeenBft > (w.windBft ?? 0) + 1) daten.push(`Böen ${w.boeenBft} Bft`);
  if (w.sichtMin != null) daten.push(w.sichtMin < 1000 ? 'Nebel' : w.sichtMin < 5000 ? `Sicht ${(w.sichtMin / 1000).toFixed(1).replace('.', ',')} km` : 'gute Sicht');
  if (w.text && w.text !== 'Nebel') daten.push(w.text);
  if (w.regenMm > 0.2) daten.push(`${String(w.regenMm).replace('.', ',')} mm Regen`);
  if (w.temp != null) daten.push(`${Math.round(w.temp)} °C`);
  if (w.wellenMax != null) daten.push(`Wellen ${w.wellenMax.toFixed(1).replace('.', ',')} m`);

  return `<div class="fenster" data-stufe="${f.stufe}" ${f.bis < jetzt ? 'data-vergangen' : ''}>
    <i class="perle" data-stufe="${f.stufe}" aria-hidden="true"></i>
    <div class="fenster-titel">
      <strong>${ART[f.art]} ${B.formatZeit(f.von)}–${B.formatZeit(f.bis)}</strong>
      ${f.licht ? `<span class="licht" data-licht="${f.licht}">${LICHT[f.licht]}</span>` : ''}
      <span class="stufe">${esc(f.stufenName)}</span>
    </div>
    ${daten.length ? `<p class="daten">${daten.map((d) => `<span>${esc(d)}</span>`).join('')}</p>` : ''}
    ${f.warnungen.length ? `<ul class="warnungen">${f.warnungen.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${f.gruende.length ? `<ul class="gruende">${f.gruende.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

start();
