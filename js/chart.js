// Liniendiagramm mit logarithmischer Zeitachse auf Canvas (ohne Bibliotheken)
(function (root) {
  'use strict';

  const DASHES = [[], [7, 4], [2, 3], [10, 3, 2, 3]];
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /** Farbe und Strichart für den i-ten Eintrag: 8 Farben × 4 Stricharten */
  function seriesStyle(i) {
    return { colorVar: '--series-' + ((i % 8) + 1), dash: DASHES[Math.floor(i / 8) % DASHES.length] };
  }

  function niceLinearTicks(max, count) {
    if (!(max > 0)) return [0, 1];
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
    const ticks = [];
    for (let v = 0; v <= max * 1.0001 + step; v += step) { ticks.push(v); if (v >= max) break; }
    return ticks;
  }

  class LogTimeChart {
    constructor(canvas, tooltip) {
      this.canvas = canvas;
      this.tooltip = tooltip;
      this.ctx = canvas.getContext('2d');
      this.data = null;
      this.hoverIndex = -1;
      new ResizeObserver(() => this.draw()).observe(canvas);
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.draw());
      const move = (e) => this.pointer(e);
      canvas.addEventListener('pointerdown', move);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.clearHover(); });
    }

    /**
     * data: { times: [s], series: [{ name, values, visible, styleIndex }],
     *         timeUnit: { label, factor }, marker: s, logY, yLabel, fmt(v) }
     */
    setData(data) {
      this.data = data;
      this.hoverIndex = -1;
      this.tooltip.hidden = true;
      this.draw();
    }

    layout() {
      const r = this.canvas.getBoundingClientRect();
      return { w: r.width, h: r.height, l: 62, r: 12, t: 14, b: 40 };
    }

    scales() {
      const d = this.data, L = this.layout();
      const pw = L.w - L.l - L.r, ph = L.h - L.t - L.b;
      const x0 = Math.log10(d.times[0] / d.timeUnit.factor);
      const x1 = Math.log10(d.times[d.times.length - 1] / d.timeUnit.factor);
      const X = (t) => L.l + ((Math.log10(t / d.timeUnit.factor) - x0) / (x1 - x0 || 1)) * pw;

      let max = 0, minPos = Infinity;
      for (const s of d.series) {
        if (!s.visible) continue;
        for (const v of s.values) {
          if (v > max) max = v;
          if (v > 0 && v < minPos) minPos = v;
        }
      }
      let Y, yTicks, y0, y1;
      if (d.logY) {
        if (!(max > 0)) max = 1;
        y1 = Math.ceil(Math.log10(max) + 1e-9);
        y0 = Math.floor(Math.log10(Math.max(minPos, max * 1e-14)));
        if (y1 - y0 < 2) y0 = y1 - 2;
        Y = (v) => L.t + (1 - (Math.log10(v) - y0) / (y1 - y0)) * ph;
        const step = Math.max(1, Math.ceil((y1 - y0) / Math.max(2, Math.floor(ph / 32))));
        yTicks = [];
        for (let e = y1; e >= y0; e -= step) yTicks.push(Math.pow(10, e));
      } else {
        yTicks = niceLinearTicks(max || 1, Math.max(2, Math.floor(ph / 45)));
        y0 = 0; y1 = yTicks[yTicks.length - 1];
        Y = (v) => L.t + (1 - v / y1) * ph;
      }
      return { L, pw, ph, X, Y, x0, x1, y0, y1, yTicks };
    }

    draw() {
      const c = this.canvas, ctx = this.ctx, d = this.data;
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      if (!rect.width) return;
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      if (!d || d.times.length < 2) return;

      const S = this.scales(), { L, X, Y } = S;
      const ink2 = css('--ink-2'), muted = css('--muted'), grid = css('--grid'), axis = css('--axis');
      ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.lineWidth = 1;

      // Gitter und y-Achse
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const v of S.yTicks) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = grid;
        ctx.beginPath(); ctx.moveTo(L.l, y); ctx.lineTo(L.w - L.r, y); ctx.stroke();
        ctx.fillStyle = muted;
        ctx.fillText(d.logY ? '10' + Fmt.sup(Math.round(Math.log10(v))) : Fmt.num(v, 3), L.l - 6, y);
      }

      // x-Achse: Dekaden der gewählten Einheit
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const e0 = Math.ceil(S.x0 - 1e-9), e1 = Math.floor(S.x1 + 1e-9);
      const maxLabels = Math.max(2, Math.floor(S.pw / 44));
      const step = Math.max(1, Math.ceil((e1 - e0 + 1) / maxLabels));
      for (let e = e0; e <= e1; e++) {
        const x = Math.round(X(Math.pow(10, e) * d.timeUnit.factor)) + 0.5;
        ctx.strokeStyle = grid;
        ctx.beginPath(); ctx.moveTo(x, L.t); ctx.lineTo(x, L.h - L.b); ctx.stroke();
        if ((e - e0) % step === 0) {
          ctx.fillStyle = muted;
          ctx.fillText(e >= -2 && e <= 3 ? Fmt.num(Math.pow(10, e)) : '10' + Fmt.sup(e), x, L.h - L.b + 6);
        }
      }
      ctx.strokeStyle = axis;
      ctx.beginPath();
      ctx.moveTo(L.l, L.h - L.b + 0.5); ctx.lineTo(L.w - L.r, L.h - L.b + 0.5);
      ctx.stroke();
      ctx.fillStyle = ink2;
      ctx.textBaseline = 'bottom';
      ctx.fillText('Zeit in ' + d.timeUnit.label + ' (logarithmisch)', L.l + S.pw / 2, L.h - 2);
      ctx.save();
      ctx.translate(12, L.t + S.ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'middle';
      ctx.fillText(d.yLabel, 0, 0);
      ctx.restore();

      // Datenlinien
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.l, L.t - 2, S.pw, S.ph + 4);
      ctx.clip();
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const floor = d.logY ? Math.pow(10, S.y0 - 1) : -Infinity;
      d.series.forEach((s) => {
        if (!s.visible) return;
        const st = seriesStyle(s.styleIndex);
        ctx.strokeStyle = css(st.colorVar);
        ctx.setLineDash(st.dash);
        ctx.beginPath();
        let pen = false;
        for (let k = 0; k < d.times.length; k++) {
          const v = s.values[k];
          if (!(v > floor)) { pen = false; continue; }
          const x = X(d.times[k]), y = Y(v);
          if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          pen = true;
        }
        ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.restore();

      // Markierung des gewählten Zeitpunkts
      if (d.marker > 0 && d.marker >= d.times[0] && d.marker <= d.times[d.times.length - 1]) {
        const x = Math.round(X(d.marker)) + 0.5;
        ctx.strokeStyle = ink2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, L.t); ctx.lineTo(x, L.h - L.b); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = ink2;
        ctx.textAlign = x > L.w - 70 ? 'right' : 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Zeitpunkt', x + (ctx.textAlign === 'left' ? 4 : -4), L.t);
      }

      // Fadenkreuz
      if (this.hoverIndex >= 0) {
        const k = this.hoverIndex, x = Math.round(X(d.times[k])) + 0.5;
        ctx.strokeStyle = axis;
        ctx.beginPath(); ctx.moveTo(x, L.t); ctx.lineTo(x, L.h - L.b); ctx.stroke();
        const surface = css('--surface');
        for (const s of d.series) {
          const v = s.values[k];
          if (!s.visible || !(v > floor) || (d.logY && v < Math.pow(10, S.y0))) continue;
          ctx.fillStyle = css(seriesStyle(s.styleIndex).colorVar);
          ctx.strokeStyle = surface;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, Y(v), 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        }
        ctx.lineWidth = 1;
      }
    }

    pointer(e) {
      const d = this.data;
      if (!d) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const S = this.scales();
      if (px < S.L.l - 10 || px > S.L.w - S.L.r + 10) { this.clearHover(); return; }
      // nächstgelegener Zeitpunkt (Zeiten sind logarithmisch äquidistant)
      const frac = Math.min(1, Math.max(0, (px - S.L.l) / S.pw));
      const k = Math.round(frac * (d.times.length - 1));
      this.hoverIndex = k;
      this.draw();
      this.showTooltip(k, px, S);
    }

    clearHover() {
      this.hoverIndex = -1;
      this.tooltip.hidden = true;
      this.draw();
    }

    showTooltip(k, px, S) {
      const d = this.data, tip = this.tooltip;
      const rows = d.series
        .filter((s) => s.visible && s.values[k] > 0)
        .sort((a, b) => b.values[k] - a.values[k]);
      const shown = rows.slice(0, 8);
      tip.innerHTML = '';
      const head = document.createElement('div');
      head.className = 't';
      head.textContent = 't = ' + Fmt.time(d.times[k], 3);
      tip.appendChild(head);
      for (const s of shown) {
        const r = document.createElement('div');
        r.className = 'r';
        const name = document.createElement('span');
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = css(seriesStyle(s.styleIndex).colorVar);
        name.append(sw, s.name);
        const val = document.createElement('b');
        val.textContent = d.fmt(s.values[k]);
        r.append(name, val);
        tip.appendChild(r);
      }
      if (rows.length > shown.length) {
        const more = document.createElement('div');
        more.className = 'r';
        more.textContent = `… ${rows.length - shown.length} weitere`;
        tip.appendChild(more);
      }
      if (!rows.length) {
        const r = document.createElement('div');
        r.className = 'r';
        r.textContent = 'keine Werte';
        tip.appendChild(r);
      }
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const left = px + 12 + tw > S.L.w ? px - 12 - tw : px + 12;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = S.L.t + 'px';
    }
  }

  root.LogTimeChart = LogTimeChart;
  root.seriesStyle = seriesStyle;
})(self);
