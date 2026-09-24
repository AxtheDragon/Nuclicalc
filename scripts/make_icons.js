#!/usr/bin/env node
// Erzeugt die App-Icons (Strahlenwarnzeichen) als SVG und PNG, ohne Abhängigkeiten.
// Aufruf: node scripts/make_icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');
const BG = [0xfa, 0xb2, 0x19];
const FG = [0x1a, 0x1a, 0x19];

// Geometrie in Einheiten des Radius R = 1: Mittelscheibe r, Blätter von 1,5r bis 5r, je 60°
const r = 0.2;
function inTrefoil(x, y) {
  const d = Math.hypot(x, y);
  if (d <= r) return true;
  if (d < 1.5 * r || d > 5 * r) return false;
  const a = (Math.atan2(-y, x) * 180) / Math.PI; // y nach oben
  // Blätter zentriert bei 30°, 150°, 270°
  for (const c of [30, 150, 270]) {
    let diff = Math.abs(((a - c + 540) % 360) - 180);
    if (diff <= 30) return true;
  }
  return false;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** size: Pixel; scale: Anteil des Icons, den das Zeichen einnimmt; round: runde Ecken */
function png(size, scale, round) {
  const SS = 4; // Überabtastung für Kantenglättung
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const radius = round ? size * 0.18 : 0;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let fg = 0, inside = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const X = px + (sx + 0.5) / SS, Y = py + (sy + 0.5) / SS;
        // abgerundetes Quadrat
        const cx = Math.min(Math.max(X, radius), size - radius), cy = Math.min(Math.max(Y, radius), size - radius);
        if (radius && Math.hypot(X - cx, Y - cy) > radius) continue;
        inside++;
        const u = ((X / size) * 2 - 1) / scale, v = ((Y / size) * 2 - 1) / scale;
        if (inTrefoil(u, v)) fg++;
      }
      const n = SS * SS, o = py * (size * 4 + 1) + 1 + px * 4;
      const f = inside ? fg / inside : 0;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - f) + FG[c] * f);
      raw[o + 3] = Math.round((inside / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg() {
  const R = 26, c = 32;
  const pt = (rad, deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(c + rad * Math.cos(a)).toFixed(3)} ${(c - rad * Math.sin(a)).toFixed(3)}`;
  };
  const blades = [30, 150, 270].map((m) => {
    const r1 = 1.5 * r * R, r2 = 5 * r * R;
    return `M${pt(r1, m - 30)} L${pt(r2, m - 30)} A${r2} ${r2} 0 0 0 ${pt(r2, m + 30)} ` +
      `L${pt(r1, m + 30)} A${r1} ${r1} 0 0 1 ${pt(r1, m - 30)}Z`;
  }).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#fab219"/>
  <g fill="#1a1a19"><circle cx="${c}" cy="${c}" r="${(r * R).toFixed(3)}"/><path d="${blades}"/></g>
</svg>
`;
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg());
fs.writeFileSync(path.join(OUT, 'icon-192.png'), png(192, 0.8, true));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), png(512, 0.8, true));
// maskierbar: vollflächig, Zeichen innerhalb der sicheren Zone (80 %-Kreis)
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), png(512, 0.62, false));
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), png(180, 0.72, false));
console.log('Icons geschrieben nach ' + OUT);
