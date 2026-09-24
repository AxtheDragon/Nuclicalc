#!/usr/bin/env node
/*
 * Importiert Grundzustandsdaten aus der IAEA-Nuklidkarte (LiveChart of
 * Nuclides, https://www-nds.iaea.org/relnsd/vcharthtml/VChartHTML.html)
 * im CSV-Format und überführt sie in das Format von data/nuclides.json.
 *
 * Aufruf:
 *   node scripts/import_iaea.js --download [Optionen]
 *   node scripts/import_iaea.js --input livechart.csv [Optionen]
 *
 * Optionen:
 *   --download            CSV direkt von der LiveChart-API laden
 *                         (https://nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides=all)
 *   --input <datei>       vorher heruntergeladene CSV verwenden
 *   --output <datei>      Zieldatei (Standard: data/nuclides.json)
 *   --roots U-238,Cs-137  nur diese Nuklide und alle ihre Töchter übernehmen
 *   --overwrite           vorhandene Einträge durch die CSV-Daten ersetzen
 *                         (Standard: vorhandene Einträge bleiben unverändert,
 *                         nur neue Nuklide kommen hinzu – so bleiben von Hand
 *                         gepflegte Isomere wie Tc-99m erhalten)
 *   --dry-run             nur zusammenfassen, nichts schreiben
 *
 * Hinweise zu den Daten:
 *   - Die CSV enthält nur Grundzustände. Zerfälle führen deshalb immer in
 *     den Grundzustand der Tochter; Isomere (z. B. Ba-137m) müssen von Hand
 *     ergänzt werden.
 *   - Spontanspaltung (SF) hat keine eindeutige Tochter und wird als
 *     Zweig ohne Tochter ("daughter": null) gespeichert; die App behandelt
 *     ihn als Verlust aus der Kette.
 *   - Verzweigungsanteile werden auf die Summe 1 normiert.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const API_URL = 'https://nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides=all';
const YEAR = 365.25 * 86400;
const UNIT_SEC = {
  ys: 1e-24, zs: 1e-21, as: 1e-18, fs: 1e-15, ps: 1e-12, ns: 1e-9, us: 1e-6, 'µs': 1e-6,
  ms: 1e-3, s: 1, m: 60, min: 60, h: 3600, d: 86400, y: YEAR, ky: 1e3 * YEAR,
  my: 1e6 * YEAR, gy: 1e9 * YEAR, ty: 1e12 * YEAR, py: 1e15 * YEAR, ey: 1e18 * YEAR,
  zy: 1e21 * YEAR, yy: 1e24 * YEAR,
};

// Änderung von (Z, N) je Zerfallsart
const MODES = {
  'A': [-2, -2], 'B-': [1, -1], '2B-': [2, -2], 'B-N': [1, -2], 'B-2N': [1, -3],
  'B-3N': [1, -4], 'B-A': [-1, -3], 'B-P': [0, -1],
  'EC': [-1, 1], 'B+': [-1, 1], 'EC+B+': [-1, 1], '2EC': [-2, 2], '2B+': [-2, 2],
  'ECP': [-2, 1], 'B+P': [-2, 1], 'EC+B+P': [-2, 1], 'ECA': [-3, -1], 'B+A': [-3, -1],
  'EC2P': [-3, 1], 'B+2P': [-3, 1],
  'P': [-1, 0], '2P': [-2, 0], 'N': [0, -1], '2N': [0, -2], 'IT': [0, 0],
};
const NORMALIZED_MODE = { 'EC+B+': 'EC', 'B+': 'EC' };

// Elementsymbole nach Ordnungszahl (Index = Z)
const ELEMENTS = ('n H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
  'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm ' +
  'Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu ' +
  'Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' ');

// ------------------------------------------------------------------ CSV
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

function num(s) {
  if (s == null) return NaN;
  const m = String(s).replace(',', '.').match(/[-+]?\d*\.?\d+(e[-+]?\d+)?/i);
  return m ? Number(m[0]) : NaN;
}

function cap(sym) {
  return sym.charAt(0).toUpperCase() + sym.slice(1).toLowerCase();
}

// ---------------------------------------------------------- Umwandlung
/**
 * Wandelt die CSV-Zeilen in Nuklideinträge um.
 * Rückgabe: { nuclides: {name: entry}, warnings: [] }
 */
function convert(rows) {
  const warnings = [];
  const symbolOfZ = new Map(ELEMENTS.map((e, z) => [z, e]));
  const zOfSymbol = new Map(ELEMENTS.map((e, z) => [e, z]));
  for (const r of rows) {
    const z = Number(r.z);
    if (r.symbol && Number.isFinite(z)) {
      symbolOfZ.set(z, cap(r.symbol));
      zOfSymbol.set(cap(r.symbol), z);
    }
  }
  const name = (z, n) => (symbolOfZ.has(z) ? `${symbolOfZ.get(z)}-${z + n}` : null);

  const nuclides = {};
  for (const r of rows) {
    const z = Number(r.z), n = Number(r.n);
    if (!Number.isFinite(z) || !Number.isFinite(n) || !r.symbol) continue;
    const id = name(z, n);
    const entry = { halfLife: null, stable: false, mass: null, decays: [] };

    const am = num(r.atomic_mass); // in Mikro-u
    entry.mass = Number.isFinite(am) ? Number((am * 1e-6).toFixed(9)) : z + n;

    const hlText = (r.half_life || '').toUpperCase();
    if (hlText === 'STABLE') {
      entry.stable = true;
      nuclides[id] = entry;
      continue;
    }
    let hl = num(r.half_life_sec);
    if (!Number.isFinite(hl)) {
      const v = num(r.half_life), u = (r.unit_hl || '').toLowerCase();
      if (Number.isFinite(v) && UNIT_SEC[u]) hl = v * UNIT_SEC[u];
    }
    if (!(hl > 0)) {
      warnings.push(`${id}: keine Halbwertszeit – übersprungen`);
      continue;
    }
    entry.halfLife = Number(hl.toPrecision(10));

    // Zerfallsarten decay_1..decay_3 (weitere, falls vorhanden)
    const raw = [];
    for (let k = 1; k <= 9; k++) {
      const mode = (r[`decay_${k}`] || '').toUpperCase().replace(/\s+/g, '');
      if (!mode) continue;
      raw.push({ mode, pct: num(r[`decay_${k}_%`]) });
    }
    if (raw.length === 0) {
      warnings.push(`${id}: keine Zerfallsart angegeben – übersprungen`);
      continue;
    }
    if (raw.length === 1 && !Number.isFinite(raw[0].pct)) raw[0].pct = 100;
    const known = raw.filter((d) => Number.isFinite(d.pct) && d.pct > 0);
    const sum = known.reduce((a, d) => a + d.pct, 0);
    if (sum <= 0) {
      warnings.push(`${id}: Verzweigungsanteile fehlen – übersprungen`);
      continue;
    }
    if (Math.abs(sum - 100) > 0.1) warnings.push(`${id}: Summe der Anteile ${sum} % – normiert`);

    for (const d of known) {
      let dz, dn, mode = d.mode;
      if (MODES[mode]) [dz, dn] = MODES[mode];
      else if (mode === 'SF') { entry.decays.push({ mode, branch: d.pct / sum, daughter: null }); continue; }
      else {
        // Clusterzerfall, z. B. "14C" oder "24NE"
        const m = mode.match(/^(\d+)([A-Z]{1,2})$/);
        const cz = m && zOfSymbol.get(cap(m[2]));
        if (!m || cz == null) {
          warnings.push(`${id}: unbekannte Zerfallsart "${mode}" – als Verlust behandelt`);
          entry.decays.push({ mode, branch: d.pct / sum, daughter: null });
          continue;
        }
        dz = -cz; dn = -(Number(m[1]) - cz);
      }
      entry.decays.push({
        mode: NORMALIZED_MODE[mode] || mode,
        branch: d.pct / sum,
        daughter: name(z + dz, n + dn),
      });
    }
    // gleiche Tochter + gleiche Art zusammenfassen
    const merged = new Map();
    for (const d of entry.decays) {
      const key = d.mode + '>' + d.daughter;
      if (merged.has(key)) merged.get(key).branch += d.branch;
      else merged.set(key, { ...d });
    }
    entry.decays = [...merged.values()].map((d) => ({ ...d, branch: Number(d.branch.toPrecision(12)) }));
    nuclides[id] = entry;
  }

  // Töchter, die nicht in der CSV stehen, als Verlust markieren
  for (const [id, e] of Object.entries(nuclides)) {
    for (const d of e.decays) {
      if (d.daughter && !nuclides[d.daughter]) {
        warnings.push(`${id}: Tochter ${d.daughter} nicht in der CSV – Zweig als Verlust`);
        d.daughter = null;
      }
    }
  }
  return { nuclides, warnings };
}

/** Behält nur die Nuklide, die von den Wurzeln aus erreichbar sind. */
function restrictToRoots(nuclides, roots) {
  const keep = new Set(), stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    if (keep.has(id) || !nuclides[id]) continue;
    keep.add(id);
    for (const d of nuclides[id].decays) if (d.daughter) stack.push(d.daughter);
  }
  return Object.fromEntries([...keep].map((id) => [id, nuclides[id]]));
}

function merge(existing, imported, overwrite) {
  const out = { ...existing };
  let added = 0, replaced = 0;
  for (const [id, e] of Object.entries(imported)) {
    if (!out[id]) { out[id] = e; added++; }
    else if (overwrite) { out[id] = e; replaced++; }
  }
  return { nuclides: out, added, replaced };
}

function serialize(data) {
  return JSON.stringify(data, null, 1).replace(
    /\{\n\s+"mode": ("[^"]+"),\n\s+"branch": ([^,]+),\n\s+"daughter": ("[^"]+"|null)\n\s+\}/g,
    '{"mode": $1, "branch": $2, "daughter": $3}') + '\n';
}

// -------------------------------------------------------------- Aufruf
function parseArgs(argv) {
  const a = { output: path.join(__dirname, '..', 'data', 'nuclides.json') };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--download') a.download = true;
    else if (k === '--overwrite') a.overwrite = true;
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--input') a.input = argv[++i];
    else if (k === '--output') a.output = argv[++i];
    else if (k === '--roots') a.roots = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error('Unbekannte Option: ' + k);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.download && !args.input)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '').replace(/^ \* ?/gm, ''));
    process.exit(args.help ? 0 : 1);
  }
  let text;
  if (args.download) {
    console.log('Lade ' + API_URL);
    // Die LiveChart-API verlangt einen User-Agent-Header.
    const res = await fetch(API_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (nuclicalc import script)' } });
    if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`);
    text = await res.text();
    const cache = path.join(__dirname, '..', 'livechart_ground_states.csv');
    fs.writeFileSync(cache, text);
    console.log('CSV gespeichert unter ' + cache);
  } else {
    text = fs.readFileSync(args.input, 'utf8');
  }

  const rows = parseCSV(text);
  if (!rows.length || !('half_life_sec' in rows[0] || 'half_life' in rows[0])) {
    throw new Error('Unerwartetes CSV-Format – erwartet wird der LiveChart-Export "ground_states".');
  }
  let { nuclides, warnings } = convert(rows);
  if (args.roots) {
    const missing = args.roots.filter((r) => !nuclides[r]);
    if (missing.length) warnings.push('Nicht in der CSV: ' + missing.join(', '));
    nuclides = restrictToRoots(nuclides, args.roots);
  }

  let existing = { meta: {}, nuclides: {} };
  if (fs.existsSync(args.output)) existing = JSON.parse(fs.readFileSync(args.output, 'utf8'));
  const result = merge(existing.nuclides || {}, nuclides, args.overwrite);

  for (const w of warnings.slice(0, 50)) console.warn('Hinweis: ' + w);
  if (warnings.length > 50) console.warn(`… und ${warnings.length - 50} weitere Hinweise`);
  console.log(`${Object.keys(nuclides).length} Nuklide aus der CSV, ${result.added} neu, ${result.replaced} ersetzt, ` +
    `${Object.keys(result.nuclides).length} insgesamt.`);

  if (args.dryRun) return;
  const meta = {
    ...(existing.meta || {}),
    iaeaImport: `IAEA LiveChart of Nuclides, importiert am ${new Date().toISOString().slice(0, 10)}`,
  };
  fs.writeFileSync(args.output, serialize({ meta, nuclides: result.nuclides }));
  console.log('Geschrieben: ' + args.output);
}

if (require.main === module) {
  main().catch((e) => { console.error('Fehler: ' + e.message); process.exit(1); });
}

module.exports = { parseCSV, convert, restrictToRoots, merge };
