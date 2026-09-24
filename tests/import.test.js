// Tests für scripts/import_iaea.js. Ausführen mit: node tests/import.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { parseCSV, convert, restrictToRoots, merge } = require('../scripts/import_iaea.js');

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('IAEA-Import');
const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'livechart_sample.csv'), 'utf8');
const { nuclides, warnings } = convert(parseCSV(csv));

test('stabile Nuklide und Halbwertszeiten werden erkannt', () => {
  assert.strictEqual(nuclides['Ba-137'].stable, true);
  assert.strictEqual(nuclides['Cs-137'].halfLife, 949252608);
  assert.strictEqual(nuclides['Po-212'].halfLife, 2.943e-7);
  assert.ok(Math.abs(nuclides['Cs-137'].mass - 136.9070895) < 1e-9);
});

test('Töchter werden aus der Zerfallsart berechnet, Verzweigungen normiert', () => {
  const bi = nuclides['Bi-212'].decays;
  assert.deepStrictEqual(bi.map((d) => d.daughter), ['Po-212', 'Tl-208']);
  assert.ok(Math.abs(bi[0].branch - 0.6406) < 1e-12);
  assert.strictEqual(nuclides['Cs-137'].decays[0].daughter, 'Ba-137');
});

test('Spontanspaltung ohne Tochter, fehlende Töchter als Verlust', () => {
  const u = nuclides['U-238'].decays;
  const sf = u.find((d) => d.mode === 'SF');
  assert.strictEqual(sf.daughter, null);
  assert.ok(Math.abs(u.reduce((a, d) => a + d.branch, 0) - 1) < 1e-12);
  // Th-234 → Pa-234 steht nicht in der Beispiel-CSV
  assert.strictEqual(nuclides['Th-234'].decays[0].daughter, null);
  assert.ok(warnings.some((w) => w.includes('Pa-234')));
});

test('Clusterzerfall (14C) wird als Verlust markiert, wenn die Tochter fehlt', () => {
  const c = nuclides['Ra-223'].decays.find((d) => d.mode === '14C');
  assert.ok(c);
  assert.strictEqual(c.daughter, null); // Pb-209 fehlt in der Beispiel-CSV
  assert.ok(warnings.some((w) => w.includes('Tochter Pb-209')));
});

test('--roots und Zusammenführen', () => {
  const sub = restrictToRoots(nuclides, ['Bi-212']);
  assert.deepStrictEqual(Object.keys(sub).sort(), ['Bi-212', 'Pb-208', 'Po-212', 'Tl-208']);
  const existing = { 'Bi-212': { halfLife: 1, stable: false, decays: [] } };
  const keep = merge(existing, sub, false);
  assert.strictEqual(keep.nuclides['Bi-212'].halfLife, 1);
  assert.strictEqual(keep.added, 3);
  const over = merge(existing, sub, true);
  assert.strictEqual(over.nuclides['Bi-212'].halfLife, 3633);
});

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
