// Oberfläche: Eingabe, Berechnung, Tabelle, Diagramm
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const TIME_UNITS = [['s', 's'], ['min', 'min'], ['h', 'h'], ['d', 'd (Tage)'], ['a', 'a (Jahre)']];
  const AMOUNT_UNITS = [
    ['atoms', 'Atome'], ['mol', 'mol'],
    ['g', 'g'], ['mg', 'mg'], ['µg', 'µg'], ['ng', 'ng'],
    ['Bq', 'Bq'], ['kBq', 'kBq'], ['MBq', 'MBq'], ['GBq', 'GBq'], ['TBq', 'TBq'],
  ];
  const MODE_LABEL = { A: 'α', 'B-': 'β⁻', EC: 'EC/β⁺', 'B+': 'β⁺', IT: 'IT', SF: 'SF' };
  const N_POINTS = 241;
  const STORAGE_KEY = 'nuclicalc-state-v1';

  const PRESETS = [
    { label: 'U-238, 1 g', rows: [['U-238', '1', 'g']], t: ['1', 'a'] },
    { label: 'U-235, 1 g', rows: [['U-235', '1', 'g']], t: ['1', 'a'] },
    { label: 'Th-232, 1 g', rows: [['Th-232', '1', 'g']], t: ['10', 'a'] },
    { label: 'Np-237, 1 MBq', rows: [['Np-237', '1', 'MBq']], t: ['1000', 'a'] },
    { label: 'Ra-226, 1 g (Radon-Nachwachsen)', rows: [['Ra-226', '1', 'g']], t: ['30', 'd'] },
    { label: 'Mo-99/Tc-99m-Generator, 10 GBq', rows: [['Mo-99', '10', 'GBq']], t: ['24', 'h'] },
    { label: 'Cs-137 + Sr-90, je 1 kBq', rows: [['Cs-137', '1', 'kBq'], ['Sr-90', '1', 'kBq']], t: ['30', 'a'] },
    { label: 'I-131, 1 GBq', rows: [['I-131', '1', 'GBq']], t: ['8', 'd'] },
    { label: 'Co-60, 1 TBq', rows: [['Co-60', '1', 'TBq']], t: ['5', 'a'] },
    { label: 'K-40, 1 g', rows: [['K-40', '1', 'g']], t: ['1', 'a'] },
  ];

  let db = null;
  let chart = null;
  let last = null; // letztes Rechenergebnis für Diagramm
  const hidden = new Set();

  // ------------------------------------------------------------ Hilfen
  function fillSelect(sel, options, value) {
    sel.innerHTML = '';
    for (const [v, label] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      sel.appendChild(o);
    }
    if (value) sel.value = value;
  }

  const seconds = (value, unit) => value * Decay.TIME_UNITS[unit];

  function describe(name) {
    const n = db[name];
    if (n.stable) return 'stabil';
    const modes = n.decays.map((d) => {
      const pct = d.branch >= 0.9999 ? '' : ' ' + Fmt.num(d.branch * 100, 3) + ' %';
      return (MODE_LABEL[d.mode] || d.mode) + pct + ' → ' + (d.daughter || 'Spaltprodukte');
    });
    return 'T½ = ' + Fmt.time(n.halfLife) + ' · ' + modes.join(', ');
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(readState())); } catch (e) { /* privat/gesperrt */ }
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }

  function readState() {
    return {
      rows: [...document.querySelectorAll('.row')].map((r) => [
        r.querySelector('.nuc').value, r.querySelector('.amt').value, r.querySelector('.unit').value,
      ]),
      t: [$('t').value, $('tUnit').value],
      auto: $('autoRange').checked,
      t1: [$('t1').value, $('t1Unit').value],
      t2: [$('t2').value, $('t2Unit').value],
      qty: document.querySelector('input[name="qty"]:checked').value,
      logY: $('logY').checked,
      showStable: $('showStable').checked,
    };
  }

  function applyState(s) {
    $('rows').innerHTML = '';
    (s.rows && s.rows.length ? s.rows : [['', '1', 'g']]).forEach((r) => addRow(...r));
    if (s.t) { $('t').value = s.t[0]; $('tUnit').value = s.t[1]; }
    if ('auto' in s) $('autoRange').checked = s.auto;
    if (s.t1) { $('t1').value = s.t1[0]; $('t1Unit').value = s.t1[1]; }
    if (s.t2) { $('t2').value = s.t2[0]; $('t2Unit').value = s.t2[1]; }
    if (s.qty) { const q = document.querySelector(`input[name="qty"][value="${s.qty}"]`); if (q) q.checked = true; }
    if ('logY' in s) $('logY').checked = s.logY;
    if ('showStable' in s) $('showStable').checked = s.showStable;
    updateRangeFields();
  }

  // ------------------------------------------------------ Eingabezeilen
  function addRow(nuc = '', amount = '1', unit = 'g') {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <input class="nuc" type="text" list="nuclideList" placeholder="z. B. U-238" autocomplete="off"
        autocapitalize="characters" spellcheck="false" aria-label="Nuklid">
      <input class="amt" type="text" inputmode="decimal" aria-label="Menge">
      <select class="unit" aria-label="Einheit der Menge"></select>
      <button type="button" class="del" aria-label="Zeile entfernen">×</button>
      <p class="msg" aria-live="polite"></p>`;
    row.querySelector('.nuc').value = nuc;
    row.querySelector('.amt').value = amount;
    fillSelect(row.querySelector('.unit'), AMOUNT_UNITS, unit);
    row.querySelector('.del').addEventListener('click', () => {
      row.remove();
      if (!document.querySelector('.row')) addRow();
      saveState();
    });
    row.querySelector('.nuc').addEventListener('change', () => { validateRow(row); saveState(); });
    row.querySelector('.nuc').addEventListener('input', () => validateRow(row, true));
    $('rows').appendChild(row);
    if (db) validateRow(row, true);
    return row;
  }

  // Prüft eine Zeile; gibt { nuclide, atoms } oder null zurück
  function validateRow(row, quiet) {
    const nucEl = row.querySelector('.nuc'), amtEl = row.querySelector('.amt');
    const msg = row.querySelector('.msg');
    const raw = nucEl.value.trim();
    msg.classList.remove('err');
    nucEl.classList.remove('invalid');
    amtEl.classList.remove('invalid');
    if (!raw) { msg.textContent = ''; return null; }
    const name = Decay.normalizeName(raw, db);
    if (!name) {
      if (!quiet) {
        msg.textContent = `„${raw}“ ist nicht im Datensatz.`;
        msg.classList.add('err');
        nucEl.classList.add('invalid');
      } else msg.textContent = '';
      return null;
    }
    if (!quiet && nucEl.value !== name) nucEl.value = name;
    msg.textContent = describe(name);
    const amount = Fmt.parse(amtEl.value);
    if (!(amount >= 0)) {
      if (!quiet) { amtEl.classList.add('invalid'); msg.textContent = 'Bitte eine Menge ≥ 0 eingeben.'; msg.classList.add('err'); }
      return null;
    }
    try {
      return { nuclide: name, atoms: Decay.toAtoms(db, name, amount, row.querySelector('.unit').value) };
    } catch (e) {
      if (!quiet) { msg.textContent = e.message; msg.classList.add('err'); }
      return null;
    }
  }

  function updateRangeFields() {
    const auto = $('autoRange').checked;
    $('rangeFields').classList.toggle('disabled', auto);
    for (const id of ['t1', 't1Unit', 't2', 't2Unit']) $(id).disabled = auto;
  }

  // Automatischer Zeitbereich aus den Halbwertszeiten
  function autoRange(order, mixture, tp) {
    const hls = order.map((n) => db[n].halfLife).filter((h) => h > 0);
    const rootHls = mixture.map((m) => db[m.nuclide].halfLife).filter((h) => h > 0);
    const shortest = hls.length ? Math.max(Math.min(...hls), 1e-3) : 1;
    let t1 = 0.1 * shortest;
    let t2 = rootHls.length ? 10 * Math.max(...rootHls) : 100 * Decay.YEAR;
    t2 = Math.min(t2, 1e12 * Decay.YEAR);
    if (tp > 0) { t1 = Math.min(t1, tp / 10); t2 = Math.max(t2, tp * 10); }
    t1 = Math.pow(10, Math.floor(Math.log10(t1)));
    t2 = Math.pow(10, Math.ceil(Math.log10(t2)));
    return [t1, t2];
  }

  function bestUnit(sec) {
    const order = ['a', 'd', 'h', 'min', 's'];
    for (const u of order) if (sec >= 10 * Decay.TIME_UNITS[u]) return u;
    return 's';
  }

  function showRangeInFields(t1, t2) {
    const u1 = bestUnit(t1 * 10), u2 = bestUnit(t2);
    $('t1').value = Fmt.num(t1 / Decay.TIME_UNITS[u1], 3);
    $('t1Unit').value = u1;
    $('t2').value = Fmt.num(t2 / Decay.TIME_UNITS[u2], 3);
    $('t2Unit').value = u2;
  }

  // ---------------------------------------------------------- Rechnen
  function calculate() {
    const err = $('error');
    err.hidden = true;
    const mixture = [];
    let bad = false;
    for (const row of document.querySelectorAll('.row')) {
      const hasText = row.querySelector('.nuc').value.trim() !== '';
      const r = validateRow(row, false);
      if (r) mixture.push(r); else if (hasText) bad = true;
    }
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (bad) return fail('Bitte die markierten Eingaben prüfen.');
    if (!mixture.length) return fail('Bitte mindestens ein Nuklid eingeben.');

    const tpv = Fmt.parse($('t').value);
    if (!(tpv >= 0)) { $('t').classList.add('invalid'); return fail('Bitte einen gültigen Zeitpunkt eingeben.'); }
    $('t').classList.remove('invalid');
    const tp = seconds(tpv, $('tUnit').value);

    let order;
    try { order = Decay.collectChain(db, mixture.map((m) => m.nuclide)).order; }
    catch (e) { return fail(e.message); }

    let t1, t2;
    if ($('autoRange').checked) {
      [t1, t2] = autoRange(order, mixture, tp);
      showRangeInFields(t1, t2);
    } else {
      t1 = seconds(Fmt.parse($('t1').value), $('t1Unit').value);
      t2 = seconds(Fmt.parse($('t2').value), $('t2Unit').value);
      if (!(t1 > 0 && t2 > t1)) return fail('Zeitbereich: „von“ muss größer als 0 und kleiner als „bis“ sein.');
    }

    const times = [];
    const l1 = Math.log10(t1), l2 = Math.log10(t2);
    for (let k = 0; k < N_POINTS; k++) times.push(Math.pow(10, l1 + (l2 - l1) * k / (N_POINTS - 1)));

    const t0 = performance.now();
    const res = Decay.computeMixture(db, mixture, [0, tp, ...times]);
    const ms = performance.now() - t0;

    last = {
      res, mixture, tp,
      times,
      series: res.results.slice(2),
      unit: $('autoRange').checked ? bestUnit(t2) : $('t2Unit').value,
    };
    renderTable(res, tp, ms);
    renderChart();
    saveState();
  }

  // ----------------------------------------------------------- Tabelle
  function renderTable(res, tp, ms) {
    const { order, results, missing } = res;
    const start = results[0], now = results[1];
    const initial = new Set(last.mixture.map((m) => m.nuclide));
    const showStable = $('showStable').checked;
    const tbody = document.querySelector('#table tbody');
    tbody.innerHTML = '';
    let sumN = 0, sumM = 0, sumA = 0;

    order.forEach((name, i) => {
      const nuc = db[name];
      const N = now.N[i], A = now.activity[i], m = Decay.atomsToGrams(db, name, N);
      sumN += N; sumM += m; sumA += A;
      if (nuc.stable && !showStable) return;
      const tr = document.createElement('tr');
      if (nuc.stable) tr.classList.add('stable');
      if (initial.has(name)) tr.classList.add('initial');
      const cells = [
        name,
        nuc.stable ? '–' : Fmt.time(nuc.halfLife, 4),
        Fmt.num(N),
        Fmt.mass(m),
        nuc.stable ? '–' : Fmt.si(A, 'Bq'),
      ];
      cells.forEach((text, c) => {
        const td = document.createElement('td');
        if (c > 0) td.className = 'num';
        if (c === 0) {
          const sw = document.createElement('span');
          sw.className = 'swatch';
          sw.style.background = `var(${seriesStyle(i).colorVar})`;
          td.appendChild(sw);
        }
        td.appendChild(document.createTextNode(text));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    let tfoot = document.querySelector('#table tfoot');
    if (!tfoot) { tfoot = document.createElement('tfoot'); $('table').appendChild(tfoot); }
    tfoot.innerHTML = '';
    const tr = document.createElement('tr');
    ['Summe', '', Fmt.num(sumN), Fmt.mass(sumM), Fmt.si(sumA, 'Bq')].forEach((t, c) => {
      const td = document.createElement('td');
      if (c > 0) td.className = 'num';
      td.textContent = t;
      tr.appendChild(td);
    });
    tfoot.appendChild(tr);

    const a0 = start.activity.reduce((a, b) => a + b, 0);
    $('summary').innerHTML = '';
    const s = $('summary');
    s.append('Nach ', strong(Fmt.time(tp)), ': Gesamtaktivität ', strong(Fmt.si(sumA, 'Bq')),
      ` (Anfang: ${Fmt.si(a0, 'Bq')}), ${order.length} Nuklide.`);

    const notes = [];
    if (missing.length) notes.push('Töchter ohne Datensatz (als Verlust gerechnet): ' + missing.join(', ') + '.');
    const lossy = order.filter((n) => (db[n].decays || []).some((d) => !d.daughter));
    if (lossy.length) notes.push('Zweige ohne Tochter (z. B. Spontanspaltung) verlassen die Kette: ' + lossy.join(', ') + '.');
    notes.push(`Rechenzeit ${Fmt.num(ms, 2)} ms.`);
    $('warnings').textContent = notes.join(' ');
    $('resultCard').hidden = false;
  }

  function strong(text) {
    const b = document.createElement('strong');
    b.textContent = text;
    return b;
  }

  // ---------------------------------------------------------- Diagramm
  function renderChart() {
    if (!last) return;
    const qty = document.querySelector('input[name="qty"]:checked').value;
    const { res, times } = last;
    const series = [];
    res.order.forEach((name, i) => {
      if (qty === 'activity' && db[name].stable) return;
      const values = new Float64Array(times.length);
      last.series.forEach((r, k) => {
        const N = r.N[i];
        values[k] = qty === 'activity' ? r.activity[i] : qty === 'mass' ? Decay.atomsToGrams(db, name, N) : N;
      });
      series.push({ name, values, visible: !hidden.has(name), styleIndex: i });
    });
    const unit = last.unit;
    const fmt = qty === 'activity' ? (v) => Fmt.si(v, 'Bq', 3) : qty === 'mass' ? (v) => Fmt.mass(v, 3) : (v) => Fmt.num(v, 3);
    const yLabel = qty === 'activity' ? 'Aktivität in Bq' : qty === 'mass' ? 'Masse in g' : 'Anzahl Atome';

    $('chartCard').hidden = false;
    chart.setData({
      times,
      series,
      timeUnit: { label: unit, factor: Decay.TIME_UNITS[unit] },
      marker: last.tp,
      logY: $('logY').checked,
      yLabel,
      fmt,
    });
    renderLegend(series);
  }

  function renderLegend(series) {
    const box = $('legend');
    box.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    for (const s of series) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(s.visible));
      const st = seriesStyle(s.styleIndex);
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 22 8');
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '1'); line.setAttribute('x2', '21');
      line.setAttribute('y1', '4'); line.setAttribute('y2', '4');
      line.setAttribute('stroke', `var(${st.colorVar})`);
      line.setAttribute('stroke-width', '2.5');
      line.setAttribute('stroke-linecap', 'round');
      if (st.dash.length) line.setAttribute('stroke-dasharray', st.dash.map((d) => d * 0.6).join(' '));
      svg.appendChild(line);
      b.append(svg, s.name);
      b.addEventListener('click', () => {
        if (hidden.has(s.name)) hidden.delete(s.name); else hidden.add(s.name);
        renderChart();
      });
      box.appendChild(b);
    }
  }

  // -------------------------------------------------------------- Start
  async function init() {
    fillSelect($('tUnit'), TIME_UNITS, 'a');
    fillSelect($('t1Unit'), TIME_UNITS, 's');
    fillSelect($('t2Unit'), TIME_UNITS, 'a');
    chart = new LogTimeChart($('chart'), $('tooltip'));

    for (const p of PRESETS) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip';
      c.textContent = p.label;
      c.addEventListener('click', () => {
        applyState({ ...readState(), rows: p.rows, t: p.t, auto: true });
        hidden.clear();
        calculate();
        $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      $('presets').appendChild(c);
    }

    $('add').addEventListener('click', () => addRow('', '1', 'g').querySelector('.nuc').focus());
    $('form').addEventListener('submit', (e) => { e.preventDefault(); calculate(); });
    $('autoRange').addEventListener('change', () => { updateRangeFields(); saveState(); });
    $('showStable').addEventListener('change', () => { if (last) renderTable(last.res, last.tp, 0); saveState(); });
    $('logY').addEventListener('change', () => { renderChart(); saveState(); });
    document.querySelectorAll('input[name="qty"]').forEach((r) => r.addEventListener('change', () => { renderChart(); saveState(); }));

    const online = () => { $('offline').hidden = navigator.onLine; };
    addEventListener('online', online);
    addEventListener('offline', online);
    online();

    try {
      const resp = await fetch('data/nuclides.json');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const json = await resp.json();
      db = json.nuclides;
      $('dataSource').textContent = `${Object.keys(db).length} Nuklide. ` + (json.meta && json.meta.source || '') +
        (json.meta && json.meta.iaeaImport ? ' · ' + json.meta.iaeaImport : '');
    } catch (e) {
      $('error').textContent = 'Nukliddaten konnten nicht geladen werden: ' + e.message;
      $('error').hidden = false;
      return;
    }

    const list = $('nuclideList');
    const names = Object.keys(db).sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n;
      list.appendChild(o);
    }

    const saved = loadState();
    applyState(saved || { rows: PRESETS[0].rows, t: PRESETS[0].t, auto: true });
    calculate();
  }

  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  init();
})();
