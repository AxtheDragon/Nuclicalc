// Zahlen- und Zeitformatierung (deutsch)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Fmt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const sup = (n) => String(n).split('').map((c) => SUP[c] || c).join('');

  function decimal(x, digits) {
    return x.toLocaleString('de-DE', { maximumSignificantDigits: digits, useGrouping: true });
  }

  /** Zahl mit 4 signifikanten Stellen, sehr große/kleine Zahlen als a·10ⁿ */
  function num(x, digits = 4) {
    if (x === 0) return '0';
    if (!Number.isFinite(x)) return '–';
    const ax = Math.abs(x);
    if (ax >= 1e-2 && ax < 1e5) return decimal(x, digits);
    let e = Math.floor(Math.log10(ax));
    let m = x / Math.pow(10, e);
    const r = Number(m.toPrecision(digits));
    if (Math.abs(r) >= 10) { m = r / 10; e += 1; } else m = r;
    return decimal(m, digits) + '·10' + sup(e);
  }

  /** Parst deutsche und englische Schreibweise: "1,5", "1.5", "2e5", "2·10^5" */
  function parse(s) {
    if (typeof s === 'number') return s;
    const unsup = { '⁻': '-', '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9 };
    let t = String(s).trim().replace(/\s+/g, '').replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => unsup[c])
      .replace(/[·x×*]10\^?/i, 'e');
    if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, ''); // 1.000.000,5
    t = t.replace(',', '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
    return Number(t);
  }

  const TIME = [
    ['a', 365.25 * 86400], ['d', 86400], ['h', 3600], ['min', 60], ['s', 1],
    ['ms', 1e-3], ['µs', 1e-6], ['ns', 1e-9],
  ];
  const TIME_LABEL = { s: 's', min: 'min', h: 'h', d: 'd', a: 'a' };

  /** Zeitspanne in passender Einheit, z. B. "4,468·10⁹ a", "3,82 d", "164,3 µs" */
  function time(sec, digits = 4) {
    if (sec == null || !Number.isFinite(sec)) return '–';
    if (sec === 0) return '0 s';
    for (const [u, f] of TIME) if (sec >= f * 0.9999) return num(sec / f, digits) + ' ' + u;
    return num(sec, digits) + ' s';
  }

  /** Wert mit SI-Präfix, z. B. 1,2 MBq */
  function si(x, unit, digits = 4) {
    if (x === 0) return '0 ' + unit;
    if (!Number.isFinite(x)) return '–';
    const P = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];
    const ax = Math.abs(x);
    if (ax >= 1e15 || ax < 1e-9) return num(x, digits) + ' ' + unit;
    for (const [f, p] of P) if (ax >= f * 0.99995) return decimal(x / f, digits) + ' ' + p + unit;
    return num(x, digits) + ' ' + unit;
  }

  /** Masse in g, kg, mg, µg, ng; darunter als g mit Exponent */
  function mass(g, digits = 4) {
    if (g === 0) return '0 g';
    if (g >= 1e3 && g < 1e6) return decimal(g / 1e3, digits) + ' kg';
    return si(g, 'g', digits);
  }

  return { num, parse, time, si, mass, sup, TIME_LABEL };
});
