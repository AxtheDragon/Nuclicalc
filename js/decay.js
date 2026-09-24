/*
 * Rechenkern für radioaktive Zerfallsreihen.
 *
 * Das Differentialgleichungssystem dN/dt = A·N wird exakt über das
 * Matrixexponential gelöst: N(t) = exp(A·t)·N(0).
 *
 * exp(A·t) wird per Skalierung und Quadrieren mit Padé-Näherung berechnet
 * (Higham 2005, "The scaling and squaring method for the matrix exponential
 * revisited"). Weil die Nuklide topologisch sortiert werden (Mutter vor
 * Tochter), ist A untere Dreiecksmatrix. Dann gilt:
 *   - Die Diagonale von exp(A·t) ist exakt exp(-lambda_i·t). Sie wird nach
 *     der Padé-Näherung und nach jedem Quadrierschritt exakt neu gesetzt
 *     (Al-Mohy & Higham 2009). Ohne diesen Schritt würde z. B. U-238 neben
 *     Po-212 (Halbwertszeiten 1e17 s vs. 3e-7 s) gar nicht zerfallen, weil
 *     1 - 1e-24 in doppelter Genauigkeit gleich 1 ist.
 *   - Die Nebendiagonalen einer Spalte j sind alle proportional zu lambda_j
 *     und behalten deshalb ihre relative Genauigkeit.
 *   - A ist außerhalb der Diagonale nichtnegativ; das Quadrieren
 *     nichtnegativer Matrizen ist frei von Auslöschung.
 *
 * Funktioniert im Browser (window.Decay) und in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Decay = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LN2 = Math.LN2;
  const AVOGADRO = 6.02214076e23;

  // ---------------------------------------------------------------------
  // Kleine Matrixbibliothek (Arrays aus Float64Array-Zeilen)
  // ---------------------------------------------------------------------

  function zeros(n) {
    const M = new Array(n);
    for (let i = 0; i < n; i++) M[i] = new Float64Array(n);
    return M;
  }

  function identity(n) {
    const M = zeros(n);
    for (let i = 0; i < n; i++) M[i][i] = 1;
    return M;
  }

  function isLowerTriangular(M) {
    const n = M.length;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) if (M[i][j] !== 0) return false;
    return true;
  }

  // C = A·B; bei unteren Dreiecksmatrizen nur k = j..i
  function matmul(A, B, lower) {
    const n = A.length;
    const C = zeros(n);
    for (let i = 0; i < n; i++) {
      const Ai = A[i], Ci = C[i];
      const kEnd = lower ? i : n - 1;
      for (let k = 0; k <= kEnd; k++) {
        const a = Ai[k];
        if (a === 0) continue;
        const Bk = B[k];
        const jEnd = lower ? k : n - 1;
        for (let j = 0; j <= jEnd; j++) Ci[j] += a * Bk[j];
      }
    }
    return C;
  }

  // Linearkombination sum(c_k · M_k) (+ c0·I)
  function lincomb(terms, c0) {
    const n = terms[0][1].length;
    const R = zeros(n);
    for (const [c, M] of terms) {
      if (c === 0) continue;
      for (let i = 0; i < n; i++) {
        const Ri = R[i], Mi = M[i];
        for (let j = 0; j < n; j++) Ri[j] += c * Mi[j];
      }
    }
    if (c0) for (let i = 0; i < n; i++) R[i][i] += c0;
    return R;
  }

  function norm1(M) {
    const n = M.length;
    let best = 0;
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += Math.abs(M[i][j]);
      if (s > best) best = s;
    }
    return best;
  }

  // Löst Q·X = P. Untere Dreiecksmatrix: Vorwärtseinsetzen,
  // sonst LU-Zerlegung mit Spaltenpivotisierung.
  function solve(Q, P, lower) {
    const n = Q.length;
    if (lower) {
      const X = zeros(n);
      for (let j = 0; j < n; j++) {
        for (let i = j; i < n; i++) {
          let s = P[i][j];
          const Qi = Q[i];
          for (let k = j; k < i; k++) s -= Qi[k] * X[k][j];
          X[i][j] = s / Qi[i];
        }
      }
      return X;
    }
    const A = Q.map((r) => Float64Array.from(r));
    const X = P.map((r) => Float64Array.from(r));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (A[p][c] === 0) throw new Error('Singuläre Matrix');
      if (p !== c) {
        [A[p], A[c]] = [A[c], A[p]];
        [X[p], X[c]] = [X[c], X[p]];
      }
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        if (f === 0) continue;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        for (let k = 0; k < n; k++) X[r][k] -= f * X[c][k];
      }
    }
    for (let c = n - 1; c >= 0; c--) {
      for (let k = 0; k < n; k++) {
        let s = X[c][k];
        for (let r = c + 1; r < n; r++) s -= A[c][r] * X[r][k];
        X[c][k] = s / A[c][c];
      }
    }
    return X;
  }

  // ---------------------------------------------------------------------
  // Matrixexponential
  // ---------------------------------------------------------------------

  const PADE = {
    3: [120, 60, 12, 1],
    5: [30240, 15120, 3360, 420, 30, 1],
    7: [17297280, 8648640, 1995840, 277200, 25200, 1512, 56, 1],
    9: [17643225600, 8821612800, 2075673600, 302702400, 30270240, 2162160,
      110880, 3960, 90, 1],
    13: [64764752532480000, 32382376266240000, 7771770303897600,
      1187353796428800, 129060195264000, 10559470521600, 670442572800,
      33522128640, 1323241920, 40840800, 960960, 16380, 182, 1],
  };
  // Größte Norm, für die die Padé-Näherung vom Grad m ohne Skalierung
  // Rundungsgenauigkeit erreicht (Higham 2005, Tabelle 2.3).
  const THETA = [
    [3, 1.495585217958292e-2],
    [5, 2.539398330063230e-1],
    [7, 9.504178996162932e-1],
    [9, 2.097847961257068e0],
  ];
  const THETA13 = 5.371920351148152;

  function padeUV(A, m, lower) {
    const b = PADE[m];
    const n = A.length;
    const A2 = matmul(A, A, lower);
    if (m === 13) {
      const A4 = matmul(A2, A2, lower);
      const A6 = matmul(A4, A2, lower);
      const U1 = lincomb([[b[13], A6], [b[11], A4], [b[9], A2]]);
      const Uin = lincomb([[1, matmul(A6, U1, lower)], [b[7], A6], [b[5], A4], [b[3], A2]], b[1]);
      const U = matmul(A, Uin, lower);
      const V1 = lincomb([[b[12], A6], [b[10], A4], [b[8], A2]]);
      const V = lincomb([[1, matmul(A6, V1, lower)], [b[6], A6], [b[4], A4], [b[2], A2]], b[0]);
      return [U, V];
    }
    // m = 3, 5, 7, 9: Potenzen A^2, A^4, ... explizit
    const pows = [identity(n), A2];
    for (let k = 2; 2 * k <= m - 1; k++) pows.push(matmul(pows[k - 1], A2, lower));
    const uTerms = [], vTerms = [];
    for (let k = 1; 2 * k <= m; k++) {
      uTerms.push([b[2 * k + 1], pows[k]]);
      vTerms.push([b[2 * k], pows[k]]);
    }
    const U = matmul(A, lincomb(uTerms, b[1]), lower);
    const V = lincomb(vTerms, b[0]);
    return [U, V];
  }

  /**
   * Matrixexponential exp(M) per Skalierung und Quadrieren mit
   * Padé-Näherung. Für untere Dreiecksmatrizen wird die Diagonale in jedem
   * Schritt exakt gesetzt (siehe Kopfkommentar).
   */
  function expm(M) {
    const n = M.length;
    if (n === 0) return [];
    const lower = isLowerTriangular(M);
    const norm = norm1(M);
    if (norm === 0) return identity(n);

    let m = 13, s = 0;
    for (const [deg, theta] of THETA) {
      if (norm <= theta) { m = deg; break; }
    }
    if (m === 13 && norm > THETA13) s = Math.max(0, Math.ceil(Math.log2(norm / THETA13)));

    const scale = Math.pow(2, -s);
    const A = M.map((r) => r.map((x) => x * scale));
    const [U, V] = padeUV(A, m, lower);
    const P = lincomb([[1, V], [1, U]]);
    const Q = lincomb([[1, V], [-1, U]]);
    let R = solve(Q, P, lower);

    const diag = lower ? Array.from({ length: n }, (_, i) => M[i][i]) : null;
    const fixDiag = (k) => {
      // Diagonale von exp(M·2^(k-s)) exakt setzen
      const f = Math.pow(2, k - s);
      for (let i = 0; i < n; i++) R[i][i] = Math.exp(diag[i] * f);
    };
    if (lower) fixDiag(0);
    for (let k = 1; k <= s; k++) {
      R = matmul(R, R, lower);
      if (lower) fixDiag(k);
    }
    return R;
  }

  // ---------------------------------------------------------------------
  // Nukliddaten → Zerfallsmatrix
  // ---------------------------------------------------------------------

  function decayConstant(nuc) {
    if (!nuc || nuc.stable || !(nuc.halfLife > 0) || !isFinite(nuc.halfLife)) return 0;
    return LN2 / nuc.halfLife;
  }

  /** Normalisiert Schreibweisen wie "u238", "U 238", "238U", "tc-99M". */
  function normalizeName(raw, db) {
    if (!raw) return null;
    let s = String(raw).trim().replace(/\s+/g, '');
    let m = s.match(/^([A-Za-z]{1,2})-?(\d{1,3})(m\d?)?$/i) ||
      null;
    let sym, mass, iso;
    if (m) { sym = m[1]; mass = m[2]; iso = m[3]; }
    else {
      m = s.match(/^(\d{1,3})(m\d?)?-?([A-Za-z]{1,2})$/i);
      if (!m) return null;
      sym = m[3]; mass = m[1]; iso = m[2];
    }
    const name = sym[0].toUpperCase() + sym.slice(1).toLowerCase() + '-' + mass + (iso ? iso.toLowerCase() : '');
    if (db && !db[name]) return null;
    return name;
  }

  /**
   * Sammelt alle Nuklide ein, die von den Startnukliden aus erreichbar sind,
   * und sortiert sie topologisch (Mutter vor Tochter).
   * Rückgabe: { order: [Namen], missing: [Töchter ohne Datensatz] }
   */
  function collectChain(db, roots) {
    const seen = new Set(), missing = new Set();
    const stack = [...roots];
    while (stack.length) {
      const name = stack.pop();
      if (seen.has(name)) continue;
      const nuc = db[name];
      if (!nuc) { missing.add(name); continue; }
      seen.add(name);
      if (nuc.stable) continue;
      for (const d of nuc.decays || []) if (d.daughter && !seen.has(d.daughter)) stack.push(d.daughter);
    }
    // Kahn-Algorithmus
    const indeg = new Map([...seen].map((n) => [n, 0]));
    for (const name of seen) {
      const nuc = db[name];
      if (nuc.stable) continue;
      for (const d of nuc.decays || []) if (seen.has(d.daughter)) indeg.set(d.daughter, indeg.get(d.daughter) + 1);
    }
    // Startreihenfolge: Eingabereihenfolge der Wurzeln, dann alphabetisch
    const rank = (n) => { const i = roots.indexOf(n); return i < 0 ? Infinity : i; };
    const ready = [...seen].filter((n) => indeg.get(n) === 0)
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const order = [];
    while (ready.length) {
      const name = ready.shift();
      order.push(name);
      const nuc = db[name];
      if (nuc.stable) continue;
      // Töchter vorn einreihen (Tiefensuche-artig), Hauptzweig zuerst:
      // aufsteigend sortieren, weil unshift die Reihenfolge umkehrt
      const ds = [...(nuc.decays || [])].sort((a, b) => a.branch - b.branch);
      for (const d of ds) {
        if (!seen.has(d.daughter)) continue;
        indeg.set(d.daughter, indeg.get(d.daughter) - 1);
        if (indeg.get(d.daughter) === 0) ready.unshift(d.daughter);
      }
    }
    if (order.length !== seen.size) throw new Error('Zerfallsdaten enthalten einen Zyklus');
    return { order, missing: [...missing] };
  }

  /**
   * Stellt die Zerfallsmatrix auf: A[i][i] = -lambda_i,
   * A[d][i] = b_(i→d)·lambda_i. Zweige ohne Tochter im Datensatz
   * (z. B. Spontanspaltung) gehen als Verlust aus dem System.
   */
  function buildMatrix(db, order) {
    const n = order.length;
    const index = new Map(order.map((name, i) => [name, i]));
    const A = zeros(n);
    const lambda = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const nuc = db[order[i]];
      const l = decayConstant(nuc);
      lambda[i] = l;
      if (l === 0) continue;
      A[i][i] = -l;
      for (const d of nuc.decays || []) {
        const j = index.get(d.daughter);
        if (j !== undefined) A[j][i] += d.branch * l;
      }
    }
    return { A, lambda, index };
  }

  // Zerlegt die Nuklidmenge in voneinander unabhängige Gruppen, damit
  // die Matrizen klein bleiben (Blockdiagonalstruktur).
  function components(A) {
    const n = A.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (let i = 0; i < n; i++)
      for (let j = 0; j < i; j++) if (A[i][j] !== 0) parent[find(i)] = find(j);
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    }
    return [...groups.values()];
  }

  /**
   * Löst N(t) = exp(A·t)·N0 für alle Zeitpunkte.
   * A: Zerfallsmatrix (n×n), N0: Anfangsbestand (Länge n), times: Sekunden.
   * Rückgabe: Array von Float64Array (je Zeitpunkt ein Bestandsvektor).
   */
  function evolve(A, N0, times) {
    const n = A.length;
    const groups = components(A).filter((g) => g.some((i) => N0[i] !== 0));
    return times.map((t) => {
      const N = new Float64Array(n);
      if (!(t > 0)) { N.set(N0); return N; }
      for (const g of groups) {
        const sub = g.map((i) => Float64Array.from(g, (j) => A[i][j] * t));
        const E = expm(sub);
        for (let a = 0; a < g.length; a++) {
          let s = 0;
          for (let b = 0; b < g.length; b++) s += E[a][b] * N0[g[b]];
          N[g[a]] = s < 0 ? 0 : s; // Rundungsrauschen um 0 abschneiden
        }
      }
      return N;
    });
  }

  /**
   * Komfortfunktion: Gemisch berechnen.
   * mixture: [{ nuclide: 'U-238', atoms: 1e20 }, ...]
   * Rückgabe: { order, lambda, results: [{ t, N, activity }] , missing }
   */
  function computeMixture(db, mixture, times) {
    const roots = [...new Set(mixture.map((m) => m.nuclide))];
    const { order, missing } = collectChain(db, roots);
    const { A, lambda, index } = buildMatrix(db, order);
    const N0 = new Float64Array(order.length);
    for (const m of mixture) N0[index.get(m.nuclide)] += m.atoms;
    const results = evolve(A, N0, times).map((N, k) => ({
      t: times[k],
      N,
      activity: N.map((x, i) => x * lambda[i]),
    }));
    return { order, lambda, results, missing };
  }

  // ---------------------------------------------------------------------
  // Einheiten
  // ---------------------------------------------------------------------

  const YEAR = 365.25 * 86400; // julianisches Jahr
  const TIME_UNITS = { s: 1, min: 60, h: 3600, d: 86400, a: YEAR };

  function molarMass(name, nuc) {
    if (nuc && nuc.mass > 0) return nuc.mass;
    const m = /-(\d+)/.exec(name);
    return m ? Number(m[1]) : NaN;
  }

  /** Umrechnung einer Mengenangabe in Atomzahl. unit: atoms|mol|g|mg|µg|ng|Bq|kBq|MBq|GBq|TBq */
  function toAtoms(db, name, value, unit) {
    const nuc = db[name];
    const massUnits = { g: 1, mg: 1e-3, 'µg': 1e-6, ng: 1e-9, kg: 1e3 };
    const actUnits = { Bq: 1, kBq: 1e3, MBq: 1e6, GBq: 1e9, TBq: 1e12, Ci: 3.7e10, mCi: 3.7e7, 'µCi': 3.7e4 };
    if (unit === 'atoms') return value;
    if (unit === 'mol') return value * AVOGADRO;
    if (unit in massUnits) return (value * massUnits[unit]) / molarMass(name, nuc) * AVOGADRO;
    if (unit in actUnits) {
      const l = decayConstant(nuc);
      if (l === 0) throw new Error(name + ' ist stabil – eine Aktivität ist nicht möglich.');
      return (value * actUnits[unit]) / l;
    }
    throw new Error('Unbekannte Einheit: ' + unit);
  }

  function atomsToGrams(db, name, atoms) {
    return (atoms / AVOGADRO) * molarMass(name, db[name]);
  }

  return {
    LN2, AVOGADRO, YEAR, TIME_UNITS,
    zeros, identity, matmul, expm, norm1,
    decayConstant, normalizeName, collectChain, buildMatrix, components, evolve,
    computeMixture, toAtoms, atomsToGrams, molarMass,
  };
});
