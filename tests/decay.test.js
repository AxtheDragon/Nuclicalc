// Unit-Tests für den Rechenkern. Ausführen mit: node tests/decay.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const Decay = require('../js/decay.js');

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function close(actual, expected, relTol, what) {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-300);
  if (!(err <= relTol)) {
    throw new Error(`${what || 'Wert'}: erwartet ${expected}, erhalten ${actual} (rel. Fehler ${err.toExponential(2)})`);
  }
}

const Y = Decay.YEAR;
const hl = (name, T, decays) => ({ halfLife: T, stable: false, decays });
const stable = () => ({ halfLife: null, stable: true, decays: [] });

console.log('Rechenkern');

test('Einzelzerfall entspricht N0·exp(-λt)', () => {
  const T = 8.0252 * 86400; // I-131
  const db = { P: hl('P', T, [{ mode: 'B-', branch: 1, daughter: 'D' }]), D: stable() };
  const l = Math.LN2 / T;
  const times = [0, 1, 3600, T, 10 * T, 100 * T];
  const r = Decay.computeMixture(db, [{ nuclide: 'P', atoms: 1e20 }], times);
  const iP = r.order.indexOf('P');
  r.results.forEach(({ t, N, activity }) => {
    const exact = 1e20 * Math.exp(-l * t);
    close(N[iP], exact, 1e-12, `N(${t})`);
    close(activity[iP], l * exact, 1e-12, `A(${t})`);
  });
});

test('Zweierkette entspricht Bateman-Formel', () => {
  const T1 = 65.976 * 3600, T2 = 6.0067 * 3600; // Mo-99 → Tc-99m (vereinfacht)
  const db = {
    M: hl('M', T1, [{ mode: 'B-', branch: 1, daughter: 'T' }]),
    T: hl('T', T2, [{ mode: 'IT', branch: 1, daughter: 'S' }]),
    S: stable(),
  };
  const l1 = Math.LN2 / T1, l2 = Math.LN2 / T2, N0 = 1e15;
  const times = [1, 60, 3600, 86400, 7 * 86400, 30 * 86400];
  const r = Decay.computeMixture(db, [{ nuclide: 'M', atoms: N0 }], times);
  const iM = r.order.indexOf('M'), iT = r.order.indexOf('T');
  r.results.forEach(({ t, N }) => {
    const n1 = N0 * Math.exp(-l1 * t);
    const n2 = N0 * l1 / (l2 - l1) * (Math.exp(-l1 * t) - Math.exp(-l2 * t));
    close(N[iM], n1, 1e-12, `Mutter(${t})`);
    close(N[iT], n2, 1e-10, `Tochter(${t})`);
  });
});

test('Zweierkette mit extrem verschiedenen Halbwertszeiten (1e17 s / 1e-6 s)', () => {
  const T1 = 4.468e9 * Y, T2 = 1e-6;
  const db = {
    P: hl('P', T1, [{ mode: 'A', branch: 1, daughter: 'D' }]),
    D: hl('D', T2, [{ mode: 'A', branch: 1, daughter: 'S' }]),
    S: stable(),
  };
  const l1 = Math.LN2 / T1, l2 = Math.LN2 / T2, N0 = 1e24;
  const times = [1e-7, 1e-3, 1, Y, 1e6 * Y, T1, 1e10 * Y];
  const r = Decay.computeMixture(db, [{ nuclide: 'P', atoms: N0 }], times);
  const [iP, iD, iS] = ['P', 'D', 'S'].map((n) => r.order.indexOf(n));
  r.results.forEach(({ t, N }) => {
    const n1 = N0 * Math.exp(-l1 * t);
    // Bateman, numerisch stabil geschrieben: l1/(l2-l1)·e^{-l1 t}·(1-e^{-(l2-l1)t})
    const n2 = N0 * l1 / (l2 - l1) * Math.exp(-l1 * t) * -Math.expm1(-(l2 - l1) * t);
    close(N[iP], n1, 1e-12, `Mutter(${t})`);
    close(N[iD], n2, 1e-9, `Tochter(${t})`);
    close(N[iP] + N[iD] + N[iS], N0, 1e-12, `Summe(${t})`);
  });
});

test('Verzweigung: Summe der Töchter = Verlust des Mutternuklids', () => {
  const T = 1.248e9 * Y; // K-40
  const db = {
    'K-40': hl('K-40', T, [
      { mode: 'B-', branch: 0.8928, daughter: 'Ca-40' },
      { mode: 'EC', branch: 0.1072, daughter: 'Ar-40' },
    ]),
    'Ca-40': stable(), 'Ar-40': stable(),
  };
  const N0 = 1e22;
  const times = [1, Y, 1e6 * Y, T, 5 * T];
  const r = Decay.computeMixture(db, [{ nuclide: 'K-40', atoms: N0 }], times);
  const [iK, iCa, iAr] = ['K-40', 'Ca-40', 'Ar-40'].map((n) => r.order.indexOf(n));
  r.results.forEach(({ t, N }) => {
    const lost = N0 * -Math.expm1(-Math.LN2 / T * t);
    close(N[iCa] + N[iAr], lost, 1e-10, `Töchter(${t})`);
    close(N[iCa] / N[iAr], 0.8928 / 0.1072, 1e-9, `Verhältnis(${t})`);
  });
});

test('Verzweigung mit Wiedervereinigung (Bi-212 → Po-212/Tl-208 → Pb-208)', () => {
  const db = {
    Bi: hl('Bi', 60.55 * 60, [
      { mode: 'B-', branch: 0.6406, daughter: 'Po' },
      { mode: 'A', branch: 0.3594, daughter: 'Tl' },
    ]),
    Po: hl('Po', 0.299e-6, [{ mode: 'A', branch: 1, daughter: 'Pb' }]),
    Tl: hl('Tl', 3.053 * 60, [{ mode: 'B-', branch: 1, daughter: 'Pb' }]),
    Pb: stable(),
  };
  const N0 = 1e12;
  const r = Decay.computeMixture(db, [{ nuclide: 'Bi', atoms: N0 }], [10, 3600, 86400]);
  const idx = (n) => r.order.indexOf(n);
  r.results.forEach(({ t, N }) => {
    const sum = N.reduce((a, b) => a + b, 0);
    close(sum, N0, 1e-12, `Erhaltung(${t})`);
    close(N[idx('Bi')], N0 * Math.exp(-Math.LN2 / (60.55 * 60) * t), 1e-12, `Bi(${t})`);
  });
});

test('Stabiles Endnuklid: zerfällt nicht und sammelt alles ein', () => {
  const db = {
    A: hl('A', 10, [{ mode: 'B-', branch: 1, daughter: 'B' }]),
    B: hl('B', 1000, [{ mode: 'B-', branch: 1, daughter: 'C' }]),
    C: stable(),
  };
  // stabiles Nuklid allein bleibt unverändert
  const r1 = Decay.computeMixture(db, [{ nuclide: 'C', atoms: 5e10 }], [1, 1e20]);
  r1.results.forEach(({ N, activity }) => {
    close(N[r1.order.indexOf('C')], 5e10, 0, 'C unverändert');
    if (activity[r1.order.indexOf('C')] !== 0) throw new Error('Aktivität eines stabilen Nuklids ≠ 0');
  });
  // nach sehr langer Zeit liegt alles im Endnuklid
  const r2 = Decay.computeMixture(db, [{ nuclide: 'A', atoms: 1e10 }, { nuclide: 'C', atoms: 1e9 }], [1e7]);
  const N = r2.results[0].N;
  close(N[r2.order.indexOf('C')], 1.1e10, 1e-12, 'Endnuklid');
  if (N[r2.order.indexOf('A')] !== 0 || N[r2.order.indexOf('B')] > 1e-200) throw new Error('Mutter/Tochter nicht vollständig zerfallen');
  if (r2.lambda[r2.order.indexOf('C')] !== 0) throw new Error('λ eines stabilen Nuklids ≠ 0');
});

test('expm allgemeiner (nicht dreieckiger) Matrizen gegen Taylorreihe', () => {
  const M = [[-0.3, 0.2, 0.1], [0.5, -1.1, 0.4], [0.0, 0.7, -0.2]].map((r) => Float64Array.from(r));
  for (const f of [0.01, 1, 20]) {
    const S = M.map((r) => r.map((x) => x * f));
    const E = Decay.expm(S);
    // Referenz: exp(S) = (exp(S/2^k))^(2^k) mit langer Taylorreihe
    const k = 10, n = 3;
    const Sk = S.map((r) => r.map((x) => x / 2 ** k));
    let T = Decay.identity(n), term = Decay.identity(n);
    for (let j = 1; j < 30; j++) {
      term = Decay.matmul(term, Sk).map((r) => r.map((x) => x / j));
      T = T.map((r, i) => r.map((x, c) => x + term[i][c]));
    }
    for (let j = 0; j < k; j++) T = Decay.matmul(T, T);
    for (let i = 0; i < n; i++) for (let c = 0; c < n; c++) close(E[i][c], T[i][c], 1e-9, `E[${i}][${c}] f=${f}`);
  }
});

// Tests mit dem mitgelieferten Datensatz
const dbPath = path.join(__dirname, '..', 'data', 'nuclides.json');
if (fs.existsSync(dbPath)) {
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8')).nuclides;
  console.log('Datensatz');

  test('Datensatz ist konsistent (Töchter vorhanden, Zweige summieren sich zu 1)', () => {
    for (const [name, n] of Object.entries(db)) {
      if (n.stable) continue;
      if (!(n.halfLife > 0)) throw new Error(name + ': Halbwertszeit fehlt');
      const sum = n.decays.reduce((a, d) => a + d.branch, 0);
      if (Math.abs(sum - 1) > 1e-6) throw new Error(`${name}: Summe der Zweige ${sum}`);
      for (const d of n.decays) if (d.daughter && !db[d.daughter]) throw new Error(`${name}: Tochter ${d.daughter} fehlt`);
    }
  });

  const series = { 'U-238': 'Pb-206', 'U-235': 'Pb-207', 'Th-232': 'Pb-208', 'Np-237': 'Tl-205' };
  for (const [root, end] of Object.entries(series)) {
    test(`${root}-Reihe endet stabil in ${end}, Atomzahl bleibt erhalten`, () => {
      const r = Decay.computeMixture(db, [{ nuclide: root, atoms: 1e20 }], [1e3 * Y, 1e9 * Y]);
      const ends = r.order.filter((n) => db[n].stable);
      if (!ends.includes(end)) throw new Error('Endnuklide: ' + ends.join(', '));
      for (const { N } of r.results) close(N.reduce((a, b) => a + b, 0), 1e20, 1e-9, 'Summe');
    });
  }

  test('U-238: säkulares Gleichgewicht nach 2 Mio. Jahren, Mutter halbiert nach T½', () => {
    const T = db['U-238'].halfLife;
    const r = Decay.computeMixture(db, [{ nuclide: 'U-238', atoms: 1e24 }], [2e6 * Y, T]);
    const { activity, N } = r.results[0];
    const aU = activity[r.order.indexOf('U-238')];
    for (const n of ['Th-234', 'U-234', 'Th-230', 'Ra-226', 'Rn-222', 'Pb-210', 'Po-210']) {
      close(activity[r.order.indexOf(n)], aU, 1e-3, n + ' / U-238');
    }
    // Po-214 wird zu 99,979 % über Bi-214 gespeist
    close(activity[r.order.indexOf('Po-214')], aU * db['Bi-214'].decays.find((d) => d.daughter === 'Po-214').branch, 2e-3, 'Po-214');
    close(r.results[1].N[r.order.indexOf('U-238')], 5e23, 1e-10, 'U-238 nach T½');
    if (!(N[r.order.indexOf('Po-212')] === undefined)) throw new Error('Po-212 gehört nicht zur U-238-Reihe');
  });
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
