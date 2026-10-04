// 2D plan of the room (top view): the readable companion of the 3D scene.
// Idea and interaction from the first website's "Room Thermal Field" (frontend/react-app, by Anton):
// a heatmap from the five sensors, sensors you can drag. Drawn from the same field as the 3D room,
// so both views always agree, and moving a sensor here moves it in 3D too.
//
// Orientation: the back wall (heater, TV) on the left, the far end (door) on the right,
// the wall with the window and door at the top, the open side of the model at the bottom.

import { ROOM, WINDOW, DOOR, HEATER, SENSORS } from './layout.js';
import { colorFor, sample } from './field.js';

const LEN_Z = ROOM.max.z - ROOM.min.z; // 7.34 m, horizontal on screen
const LEN_X = ROOM.max.x - ROOM.min.x; // 4.0 m, vertical on screen
const GRID_W = 220, GRID_H = Math.round(GRID_W * LEN_X / LEN_Z);
const SAMPLE_HEIGHT = 1.1; // m above the floor

const toUV = (x, z) => [(ROOM.max.z - z) / LEN_Z, (x - ROOM.min.x) / LEN_X];
const toXZ = (u, v) => [ROOM.min.x + v * LEN_X, ROOM.max.z - u * LEN_Z];

export class PlanView {
  constructor({ onMove, onSelect }) {
    this.onMove = onMove;
    this.onSelect = onSelect;
    this.el = document.getElementById('plan');
    this.stage = document.getElementById('plan-stage');
    this.floor = document.getElementById('plan-floor');
    this.canvas = document.getElementById('plan-canvas');
    this.canvas.width = GRID_W;
    this.canvas.height = GRID_H;
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(GRID_W, GRID_H);
    this.editing = false;
    this.lastDraw = 0;
    document.getElementById('plan-sub').textContent =
      `${LEN_X.toFixed(1)} × ${LEN_Z.toFixed(1)} m · ${(LEN_X * LEN_Z).toFixed(1)} m² · the open side of the 3D room is at the bottom`;
    this._drawLines();
    this._buildMarkers();
    new ResizeObserver(() => this._fit()).observe(this.stage);
  }

  get visible() { return !this.el.hidden; }

  setEditing(on) {
    this.editing = on;
    this.el.classList.toggle('editing', on);
  }

  /** Redraw from the current field. Cheap enough at a few times a second. */
  update({ sources, temps, target }, force = false) {
    if (!this.visible || !sources.length) return;
    const now = performance.now();
    if (!force && now - this.lastDraw < 200) return;
    this.lastDraw = now;
    const data = this.image.data;
    for (let j = 0; j < GRID_H; j++) {
      for (let i = 0; i < GRID_W; i++) {
        const [x, z] = toXZ((i + 0.5) / GRID_W, (j + 0.5) / GRID_H);
        const t = sample(sources, x, SAMPLE_HEIGHT, z);
        const [r, g, b] = colorFor(t, target);
        // calm near the target, vivid where it is clearly cold or warm
        const strength = Math.min(1, Math.abs(t - target) / 4);
        const k = 0.32 + 0.68 * strength;
        const p = (j * GRID_W + i) * 4;
        data[p] = (r * k + 0.04) * 255;
        data[p + 1] = (g * k + 0.05) * 255;
        data[p + 2] = (b * k + 0.07) * 255;
        data[p + 3] = 255;
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
    for (const [name, m] of Object.entries(this.markers)) {
      const t = temps[name];
      m.el.classList.toggle('bad', t == null);
      m.value.textContent = t == null ? 'No signal' : `${t.toFixed(1)}°`;
      this._place(name);
    }
  }

  _fit() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    const aspect = LEN_Z / LEN_X;
    let fw = w, fh = w / aspect;
    if (fh > h) { fh = h; fw = h * aspect; }
    const rect = { width: `${fw}px`, height: `${fh}px`, left: `${(w - fw) / 2}px`, top: `${(h - fh) / 2}px` };
    Object.assign(this.floor.style, rect);
    // markers sit in their own layer over the floor, so labels near the edge aren't clipped
    Object.assign(document.getElementById('plan-sensors').style, rect);
    const dw = document.getElementById('plan-dim-w'), dh = document.getElementById('plan-dim-h');
    dw.textContent = `${LEN_Z.toFixed(1)} m`;
    dh.textContent = `${LEN_X.toFixed(1)} m`;
    Object.assign(dw.style, { left: `${w / 2}px`, top: `${(h + fh) / 2 + 6}px`, transform: 'translateX(-50%)' });
    Object.assign(dh.style, { left: `${(w + fw) / 2 + 8}px`, top: `${h / 2}px`, transform: 'translateY(-50%)' });
  }

  _drawLines() {
    // viewBox in centimetres, same aspect as the floor, so nothing is distorted
    const W = LEN_Z * 100, H = LEN_X * 100;
    const svg = document.getElementById('plan-lines');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const u = z => (ROOM.max.z - z) * 100;
    const v = x => (x - ROOM.min.x) * 100;
    const [w0, w1] = [u(WINDOW.z1), u(WINDOW.z0)];
    const [d0, d1] = [u(DOOR.z1), u(DOOR.z0)];
    const hy = v(HEATER.x);
    svg.innerHTML = `
      <g fill="none" stroke-linecap="round">
        <path d="M0 ${H} L0 0 L${W} 0" stroke="rgba(255,255,255,.75)" stroke-width="7"/>
        <path d="M${W} 0 L${W} ${H} L0 ${H}" stroke="rgba(255,255,255,.28)" stroke-width="3" stroke-dasharray="14 12"/>
        <path d="M${w0} 0 L${w1} 0" stroke="#9fd3ff" stroke-width="11"/>
        <path d="M${d0} 0 L${d1} 0" stroke="#0d1219" stroke-width="12"/>
        <path d="M${d0} 4 A ${d1 - d0} ${d1 - d0} 0 0 0 ${d1} ${d1 - d0 + 4}" stroke="rgba(255,255,255,.35)" stroke-width="2.5" stroke-dasharray="6 6"/>
        <rect x="3" y="${hy - 22}" width="14" height="44" rx="4" fill="#ff8a3d" opacity=".9"/>
      </g>
      <g font-family="Ranade, sans-serif" font-size="11" font-weight="600" fill="rgba(238,243,249,.62)" letter-spacing="1.6">
        <text x="${(w0 + w1) / 2}" y="24" text-anchor="middle">WINDOW</text>
        <text x="${(d0 + d1) / 2}" y="24" text-anchor="middle">DOOR</text>
        <text x="26" y="${hy + 4}">HEATER</text>
      </g>`;
  }

  _buildMarkers() {
    const holder = document.getElementById('plan-sensors');
    holder.innerHTML = '';
    this.markers = {};
    for (const [name, info] of Object.entries(SENSORS)) {
      const el = document.createElement('button');
      el.className = 'plan-marker';
      el.setAttribute('aria-label', `${info.label} sensor`);
      el.innerHTML = `<span class="pill">${info.label} <b>—</b></span><span class="dot"></span>`;
      holder.appendChild(el);
      this.markers[name] = { el, value: el.querySelector('b'), dot: el.querySelector('.dot') };
      this._place(name);

      let dragging = false;
      el.addEventListener('pointerdown', e => {
        this.onSelect?.(name);
        if (!this.editing) return;
        dragging = true;
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      el.addEventListener('pointermove', e => {
        if (!dragging) return;
        const r = this.floor.getBoundingClientRect();
        const uu = Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width));
        const vv = Math.min(0.97, Math.max(0.03, (e.clientY - r.top) / r.height));
        const [x, z] = toXZ(uu, vv);
        this.onMove?.(name, x, z);
        this._place(name);
      });
      const stop = () => { dragging = false; };
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
      // keyboard: arrows move a sensor 10 cm while editing
      el.addEventListener('keydown', e => {
        if (!this.editing || !e.key.startsWith('Arrow')) return;
        e.preventDefault();
        const [x, , z] = SENSORS[name].pos;
        const step = 0.1;
        const nx = x + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0);
        const nz = z + (e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0);
        this.onMove?.(name, Math.min(ROOM.max.x - 0.1, Math.max(ROOM.min.x + 0.1, nx)), Math.min(ROOM.max.z - 0.1, Math.max(ROOM.min.z + 0.1, nz)));
        this._place(name);
      });
    }
  }

  _place(name) {
    const [x, , z] = SENSORS[name].pos;
    const [u, v] = toUV(x, z);
    const el = this.markers[name].el;
    Object.assign(el.style, { left: `${u * 100}%`, top: `${v * 100}%` });
    el.classList.toggle('below', v < 0.16); // near the top wall: label under the dot
    el.classList.toggle('at-left', u < 0.1);
    el.classList.toggle('at-right', u > 0.9);
  }

  refreshMarkers() { for (const name of Object.keys(this.markers)) this._place(name); }
}
