// Bernstein-Alarm – gemeinsame Bewertungslogik.
// Diese Datei wird sowohl von der Web-App (im Browser) als auch vom
// stündlichen GitHub-Job (Node.js) benutzt. So gibt es die Regeln nur einmal.

const STUNDE = 3600 * 1000;

// ---------------------------------------------------------------------------
// Standard-Einstellungen. Alles hier kann in config.json überschrieben werden.
// ---------------------------------------------------------------------------
export const STANDARD_KONFIG = {
  orte: [],
  schwellen: {
    ereignisAbCm: 75,      // Hochwasser zählt als Ereignis ab x cm über MHW
    starkAbCm: 150,        // ab hier volle Stärke
    sturmAbBft: 7,         // auflandiger Wind ab x Beaufort zählt als Sturm …
    sturmMinStunden: 6,    // … wenn er mindestens so lange anhält
    gefahrBoeenBft: 9,     // Böen ab hier: Warnung und Abwertung
  },
  abklingen: {
    vollTage: 2,           // so lange nach dem Ereignis bleibt die Chance voll
    abklingTage: 3,        // danach fällt sie über so viele Tage auf null
  },
  bonus: {
    zweiPhasen: true,      // Bonus, wenn der Wind nach dem Ereignis nachlässt oder ablandig dreht
  },
  fenster: {
    strandNachHwStunden: 2,  // Strand: Hochwasser bis HW + 2 h
    wattNachHwStunden: 1,    // Watt: ab HW + 1 h …
    wattVorNwStunden: 1,     // … bis 1 h vor Niedrigwasser
  },
  standardAuflandig: { von: 225, bis: 360 }, // SW bis N, gilt für Pegel ohne eigene Angabe
  benachrichtigung: {
    abBewertung: 0.5,      // 0.5 = "gut", 0.75 = "sehr gut"
    vorlaufTage: 3,        // nur Fenster in den nächsten x Tagen melden
  },
};

export function mischeKonfig(cfg = {}) {
  const k = structuredClone(STANDARD_KONFIG);
  for (const [schluessel, wert] of Object.entries(cfg)) {
    if (wert && typeof wert === 'object' && !Array.isArray(wert) && k[schluessel] && typeof k[schluessel] === 'object') {
      k[schluessel] = { ...k[schluessel], ...wert };
    } else {
      k[schluessel] = wert;
    }
  }
  return k;
}

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------
const begrenze = (x, min = 0, max = 1) => Math.min(max, Math.max(min, x));

const BFT_GRENZEN = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7]; // m/s

export function bft(ms) {
  if (ms == null) return null;
  let b = 0;
  while (b < BFT_GRENZEN.length && ms >= BFT_GRENZEN[b]) b++;
  return b;
}

export function bftZuMs(b) {
  return b <= 0 ? 0 : BFT_GRENZEN[Math.min(b, 12) - 1];
}

const RICHTUNGEN = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function richtungName(grad) {
  if (grad == null) return '–';
  return RICHTUNGEN[Math.round((((grad % 360) + 360) % 360) / 22.5) % 16];
}

// Liegt die Windrichtung (woher der Wind kommt) im auflandigen Sektor?
export function istAuflandig(grad, sektor) {
  if (grad == null || !sektor) return false;
  const von = ((sektor.von % 360) + 360) % 360;
  const breite = ((sektor.bis - sektor.von) % 360 + 360) % 360 || 360;
  return ((grad - von) % 360 + 360) % 360 <= breite;
}

export function cmAlsMeter(cm) {
  if (cm == null) return '–';
  const m = (cm / 100).toFixed(1).replace('.', ',');
  return (cm >= 0 ? '+' : '') + m + ' m';
}

const FMT_TAG = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit' });
const FMT_ZEIT = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
const FMT_TAGSCHLUESSEL = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });

export const formatTag = (t) => FMT_TAG.format(t);
export const formatZeit = (t) => FMT_ZEIT.format(t);
export const tagSchluessel = (t) => FMT_TAGSCHLUESSEL.format(t);
export const formatZeitpunkt = (t) => `${formatTag(t)} ${formatZeit(t)}`;

export function formatAlter(ms) {
  const h = Math.round(ms / STUNDE);
  if (h < 1) return 'gerade eben';
  if (h < 36) return `vor ${h} h`;
  const tage = Math.round(h / 24);
  return `vor ${tage} ${tage === 1 ? 'Tag' : 'Tagen'}`;
}

// Stündliche Reihe: { start (ms), schritt (ms), werte: { name: [..] } }
export function wertBei(reihe, name, t) {
  if (!reihe || !reihe.werte || !reihe.werte[name]) return null;
  const i = Math.round((t - reihe.start) / reihe.schritt);
  const arr = reihe.werte[name];
  return i >= 0 && i < arr.length ? arr[i] : null;
}

function werteIn(reihe, name, von, bis) {
  if (!reihe || !reihe.werte || !reihe.werte[name]) return [];
  const arr = reihe.werte[name];
  const a = Math.max(0, Math.floor((von - reihe.start) / reihe.schritt));
  const b = Math.min(arr.length - 1, Math.ceil((bis - reihe.start) / reihe.schritt));
  const out = [];
  for (let i = a; i <= b; i++) if (arr[i] != null) out.push(arr[i]);
  return out;
}

const mittel = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const maximum = (xs) => (xs.length ? Math.max(...xs) : null);
const minimum = (xs) => (xs.length ? Math.min(...xs) : null);

export function wetterText(code) {
  if (code == null) return null;
  if (code === 0) return 'klar';
  if (code <= 3) return 'bewölkt';
  if (code === 45 || code === 48) return 'Nebel';
  if (code >= 51 && code <= 57) return 'Niesel';
  if (code >= 61 && code <= 67) return 'Regen';
  if (code >= 71 && code <= 77) return 'Schnee';
  if (code >= 80 && code <= 82) return 'Schauer';
  if (code >= 85 && code <= 86) return 'Schneeschauer';
  if (code >= 95) return 'Gewitter';
  return null;
}

export const STUFEN = [
  { schluessel: 'sehr-gut', name: 'sehr gut', ab: 0.75 },
  { schluessel: 'gut', name: 'gut', ab: 0.5 },
  { schluessel: 'mittel', name: 'mittel', ab: 0.25 },
  { schluessel: 'gering', name: 'gering', ab: 0.01 },
  { schluessel: 'keine', name: 'keine', ab: -Infinity },
];
export function stufe(bewertung) {
  return STUFEN.find((s) => bewertung >= s.ab);
}
export const stufenRang = (schluessel) => STUFEN.length - STUFEN.findIndex((s) => s.schluessel === schluessel);

// ---------------------------------------------------------------------------
// Ereignisse: erhöhte Hochwasser und auflandige Stürme
// ---------------------------------------------------------------------------
export function ortFuer(stationId, cfg) {
  return (cfg.orte || []).find((o) => o.station === stationId) || null;
}

export function sektorFuer(stationId, cfg) {
  return ortFuer(stationId, cfg)?.auflandig || cfg.standardAuflandig;
}

export function hochwasserEreignisse(station, cfg) {
  const { ereignisAbCm, starkAbCm } = cfg.schwellen;
  const kandidaten = [
    ...(station.historie || []),
    ...(station.tiden || []).filter((x) => x.typ === 'HW').map((x) => ({ t: x.t, abw: x.abw, quelle: x.quelle })),
  ].filter((e) => e.abw != null && e.abw >= ereignisAbCm);

  // Doppelte (gleiches Hochwasser aus Messung und Vorhersage) zusammenfassen.
  const rang = { gemessen: 3, vorhersage: 2, gezeiten: 1 };
  kandidaten.sort((a, b) => a.t - b.t);
  const ergebnis = [];
  for (const e of kandidaten) {
    const letztes = ergebnis[ergebnis.length - 1];
    if (letztes && Math.abs(e.t - letztes.t) < 3 * STUNDE) {
      if ((rang[e.quelle] || 0) > (rang[letztes.quelle] || 0)) ergebnis[ergebnis.length - 1] = e;
      continue;
    }
    ergebnis.push(e);
  }
  return ergebnis.map((e) => ({
    typ: 'hochwasser',
    t: e.t,
    abw: e.abw,
    quelle: e.quelle,
    staerke: 0.5 + 0.5 * begrenze((e.abw - ereignisAbCm) / Math.max(1, starkAbCm - ereignisAbCm)),
  }));
}

export function sturmEreignisse(station, cfg) {
  const w = station.wetter;
  if (!w || !w.werte || !w.werte.wind) return [];
  const sektor = sektorFuer(station.id, cfg);
  const grenze = bftZuMs(cfg.schwellen.sturmAbBft);
  const { wind, richtung } = w.werte;
  const ergebnis = [];
  let beginn = null;
  let spitze = 0;
  let spitzeRichtung = null;
  const schliessen = (i) => {
    const dauer = i - beginn;
    if (dauer >= cfg.schwellen.sturmMinStunden) {
      const maxBft = bft(spitze);
      ergebnis.push({
        typ: 'sturm',
        t: w.start + i * w.schritt, // Ende des Sturms: ab hier läuft die Uhr
        beginn: w.start + beginn * w.schritt,
        maxBft,
        richtung: spitzeRichtung,
        staerke: 0.4 + 0.4 * begrenze((maxBft - cfg.schwellen.sturmAbBft) / 3),
      });
    }
    beginn = null;
    spitze = 0;
  };
  for (let i = 0; i < wind.length; i++) {
    const an = wind[i] != null && wind[i] >= grenze && istAuflandig(richtung[i], sektor);
    if (an) {
      if (beginn === null) beginn = i;
      if (wind[i] > spitze) { spitze = wind[i]; spitzeRichtung = richtung[i]; }
    } else if (beginn !== null) {
      schliessen(i);
    }
  }
  if (beginn !== null) schliessen(wind.length);
  return ergebnis;
}

export function abklingFaktor(alterStunden, cfg) {
  if (alterStunden < 0) return 0;
  const voll = cfg.abklingen.vollTage * 24;
  const ab = Math.max(1, cfg.abklingen.abklingTage * 24);
  if (alterStunden <= voll) return 1;
  return begrenze(1 - (alterStunden - voll) / ab);
}

export function ereignisText(e) {
  if (e.typ === 'hochwasser') {
    const q = { gemessen: 'gemessen', vorhersage: 'Vorhersage', gezeiten: 'Gezeiten' }[e.quelle] || e.quelle;
    return `Hochwasser ${cmAlsMeter(e.abw)} über MHW (${q})`;
  }
  return `Auflandiger Sturm aus ${richtungName(e.richtung)}, bis ${e.maxBft} Bft`;
}

// ---------------------------------------------------------------------------
// Zeitfenster bewerten
// ---------------------------------------------------------------------------
function lichtFuer(station, von, bis) {
  const tag = werteIn(station.wetter, 'tag', von, bis);
  if (!tag.length) return null;
  if (tag.every((x) => x === 1)) return 'tag';
  if (tag.every((x) => x === 0)) return 'nacht';
  return 'gemischt';
}

function bewerteFenster(art, von, bis, hw, nw, ereignisse, station, cfg) {
  const sektor = sektorFuer(station.id, cfg);
  const gruende = [];
  const warnungen = [];

  // 1) Grundchance aus dem stärksten vorangegangenen Ereignis
  let treiber = null;
  let basis = 0;
  for (const e of ereignisse) {
    if (e.t > von) continue;
    const f = e.staerke * abklingFaktor((von - e.t) / STUNDE, cfg);
    if (f > basis) { basis = f; treiber = e; }
  }
  if (treiber) gruende.push(`${ereignisText(treiber)}, ${formatAlter(von - treiber.t)}`);

  // 2) Wetter im Fenster
  const w = station.wetter;
  const windMittel = mittel(werteIn(w, 'wind', von, bis));
  const richtungMitte = wertBei(w, 'richtung', (von + bis) / 2);
  const boeenMax = maximum(werteIn(w, 'boeen', von, bis));
  const sichtMin = minimum(werteIn(w, 'sicht', von, bis));
  const regen = werteIn(w, 'regen', von, bis).reduce((s, x) => s + x, 0);
  const temp = wertBei(w, 'temp', (von + bis) / 2);
  const codes = werteIn(w, 'code', von, bis);
  const wellenMax = maximum(werteIn(station.wellen, 'hoehe', von, bis));
  const auflandig = richtungMitte != null ? istAuflandig(richtungMitte, sektor) : null;

  // 3) Zwei-Phasen-Bonus: Ereignis vorbei, Wind hat nachgelassen oder dreht ablandig
  let bonus = 0;
  if (cfg.bonus.zweiPhasen && basis > 0 && windMittel != null) {
    if (windMittel < bftZuMs(4)) {
      bonus = 0.1;
      gruende.push('Wind hat nachgelassen (Bonus)');
    } else if (auflandig === false) {
      bonus = 0.1;
      gruende.push('Wind dreht ablandig (Bonus)');
    }
  }

  let bewertung = Math.min(1, basis + bonus);

  // 4) Abwertungen und Warnungen
  if (boeenMax != null && boeenMax >= bftZuMs(cfg.schwellen.gefahrBoeenBft)) {
    bewertung *= 0.5;
    warnungen.push(`Sturmböen bis ${bft(boeenMax)} Bft – Vorsicht am Wasser`);
  }
  if (art === 'watt') {
    if (sichtMin != null && sichtMin < 1000) {
      bewertung *= 0.3;
      warnungen.push('Nebel (Sicht unter 1 km) – im Watt droht Orientierungsverlust');
    } else if (sichtMin != null && sichtMin < 3000) {
      warnungen.push('Diesig (Sicht unter 3 km)');
    }
    if (nw && nw.abw != null && nw.abw >= 100) {
      bewertung *= 0.3;
      warnungen.push(`Niedrigwasser bleibt ${cmAlsMeter(nw.abw)} über normal – Watt fällt kaum trocken`);
    }
    if (windMittel != null && windMittel >= bftZuMs(7)) {
      bewertung *= 0.6;
      warnungen.push('Starker Wind im Watt');
    }
  } else {
    if (sichtMin != null && sichtMin < 1000) warnungen.push('Nebel (Sicht unter 1 km)');
    if (wellenMax != null && wellenMax >= 2.5) warnungen.push(`Hohe Brandung (bis ${wellenMax.toFixed(1).replace('.', ',')} m)`);
  }

  bewertung = Math.round(bewertung * 100) / 100;
  const s = stufe(bewertung);
  return {
    art,
    von,
    bis,
    hw,
    nw,
    bewertung,
    stufe: s.schluessel,
    stufenName: s.name,
    treiber,
    licht: lichtFuer(station, von, bis),
    wetter: {
      windMs: windMittel,
      windBft: bft(windMittel),
      richtung: richtungMitte,
      auflandig,
      boeenBft: bft(boeenMax),
      sichtMin,
      regenMm: Math.round(regen * 10) / 10,
      temp,
      text: wetterText(codes.length ? Math.max(...codes) : null),
      wellenMax,
    },
    gruende,
    warnungen,
  };
}

// Hauptfunktion: alle Zeitfenster der nächsten Tage für einen Pegel.
export function berechneStation(station, cfgRoh, jetzt = Date.now()) {
  const cfg = cfgRoh.schwellen ? cfgRoh : mischeKonfig(cfgRoh);
  const ereignisse = [...hochwasserEreignisse(station, cfg), ...sturmEreignisse(station, cfg)].sort((a, b) => a.t - b.t);
  const tiden = [...(station.tiden || [])].sort((a, b) => a.t - b.t);
  const f = cfg.fenster;
  const fenster = [];

  for (let i = 0; i < tiden.length; i++) {
    const hw = tiden[i];
    if (hw.typ !== 'HW') continue;
    if (hw.t < jetzt - 3 * STUNDE || hw.t > jetzt + 8 * 24 * STUNDE) continue;
    const nw = tiden.slice(i + 1).find((x) => x.typ === 'NW' && x.t - hw.t < 10 * STUNDE) || null;

    const strand = bewerteFenster('strand', hw.t, hw.t + f.strandNachHwStunden * STUNDE, hw, nw, ereignisse, station, cfg);
    let watt = null;
    if (nw) {
      const von = hw.t + f.wattNachHwStunden * STUNDE;
      const bis = nw.t - f.wattVorNwStunden * STUNDE;
      if (bis > von) watt = bewerteFenster('watt', von, bis, hw, nw, ereignisse, station, cfg);
    }
    fenster.push({ hw, nw, strand, watt });
  }

  const zukunft = fenster.flatMap((x) => [x.strand, x.watt]).filter((x) => x && x.bis > jetzt);
  const beste = zukunft.reduce((a, b) => (!a || b.bewertung > a.bewertung ? b : a), null);
  return { ereignisse, fenster, beste };
}
