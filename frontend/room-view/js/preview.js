// Offline preview: a compact copy of the backend's room simulation (backend/src/sentinel/sim),
// so the page works without the backend. Its alerts are simple rules for show, not the real
// detector; connect to the backend for that.

import { AMBIENT, SENSOR_NAMES } from './layout.js';

const P = {
  airC: 400e3, wallC: 5e6, heaterC: 20e3,
  airToWall: 150, wallToOut: 30, gaps: 8, windowOpen: 181, doorOpen: 60,
  heaterPower: 1500, heaterToAir: 44, band: 0.5, zoneSeconds: 120, people: 60,
};
const OPENING = { closed: 0, tilted: 0.3, open: 1 };
const WINDOW_SHARE = { closed: 0.08, tilted: 0.45, open: 0.6 };
const STEP = 0.0625;
const MIN_C = 18;

export const PREVIEW_SCENARIOS = {
  quiet: [],
  cold_night: [[0, { outside_c: -10 }]],
  window_open: [[2, { window: 'open' }], [17, { window: 'closed' }]],
  window_tilted: [[2, { window: 'tilted' }], [30, { window: 'closed' }]],
  door_open: [[2, { door_open: true, corridor_c: 8 }], [17, { door_open: false, corridor_c: 19 }]],
  heater_failure: [[2, { heater: 'off' }]],
  sensor_unplugged: [[1, { unplug: 'Door' }], [6, { plug: 'Door' }]],
};

function gauss(rand) {
  let u = 0; while (!u) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
function seeded(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const median = v => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export class PreviewSource {
  constructor() {
    this.kind = 'preview';
    this.deviceId = 'preview';
    this.scenarios = Object.keys(PREVIEW_SCENARIOS);
    this.speed = 60;
    this.reset();
  }

  reset() {
    this.rand = seeded(7);
    this.controls = { outside_c: 5, corridor_c: 19, window: 'closed', door_open: false, heater: 'auto', setpoint_c: 21 };
    const air = 21, wall = (P.airToWall * air + P.wallToOut * 5) / (P.airToWall + P.wallToOut);
    this.s = { air, wall, el: air, winZone: air - 1.3, doorZone: air - 0.1, running: false, people: P.people };
    this.probes = Object.fromEntries(SENSOR_NAMES.map(n => [n, { offset: (this.rand() - 0.5) * 0.4, sensed: null, unplugged: false, hand: 0 }]));
    this.time = Date.now() - 3600e3;
    this.elapsed = 0;
    this.script = [];
    this.samples = []; // {t, temps} every 10 s, 24 h max
    this.roomTrace = []; // {t, room} for the trend
    this.metricTrace = [];
    this.issues = new Map();
    this.carry = 0;
    for (let i = 0; i < 3600; i++) this._step(); // an hour of quiet history
  }

  setControls(change) {
    for (const [k, v] of Object.entries(change)) {
      if (k === 'unplug') this.probes[v].unplugged = true;
      else if (k === 'plug') this.probes[v].unplugged = false;
      else if (k === 'hand') this.probes[v].hand = 60;
      else this.controls[k] = v;
    }
  }
  setSpeed(speed) { this.speed = speed; }
  startScenario(name) {
    this.script = (PREVIEW_SCENARIOS[name] || []).map(([m, c]) => [this.elapsed + m * 60, c]).sort((a, b) => a[0] - b[0]);
  }

  tick(realSeconds) {
    this.carry += realSeconds * this.speed;
    const n = Math.min(Math.floor(this.carry), 600);
    this.carry -= Math.floor(this.carry);
    for (let i = 0; i < n; i++) this._step();
    return n;
  }

  _step() {
    while (this.script.length && this.script[0][0] <= this.elapsed) this.setControls(this.script.shift()[1]);
    const c = this.controls, s = this.s;
    if (c.heater === 'on') s.running = true;
    else if (c.heater === 'off') s.running = false;
    else if (s.air < c.setpoint_c - P.band) s.running = true;
    else if (s.air > c.setpoint_c + P.band) s.running = false;
    const drift = Math.exp(-1 / 1800);
    s.people = P.people + (s.people - P.people) * drift + 40 * Math.sqrt(1 - drift * drift) * gauss(this.rand);
    const flows = P.heaterToAir * (s.el - s.air) + Math.max(0, s.people) - P.airToWall * (s.air - s.wall)
      - P.gaps * (s.air - c.outside_c) - P.windowOpen * OPENING[c.window] * (s.air - c.outside_c)
      - (c.door_open ? P.doorOpen * (s.air - c.corridor_c) : 0);
    s.air += flows / P.airC;
    s.wall += (P.airToWall * (s.air - s.wall) - P.wallToOut * (s.wall - c.outside_c)) / P.wallC;
    s.el += ((s.running ? P.heaterPower : 0) - P.heaterToAir * (s.el - s.air)) / P.heaterC;
    const follow = 1 - Math.exp(-1 / P.zoneSeconds);
    s.winZone += (s.air + WINDOW_SHARE[c.window] * (c.outside_c - s.air) - s.winZone) * follow;
    s.doorZone += (s.air + (c.door_open ? 0.6 : 0.05) * (c.corridor_c - s.air) - s.doorZone) * follow;
    const truth = { Centre: s.air, Window: s.winZone, Heater: s.air + 0.8 * (s.el - s.air), Door: s.doorZone, 'Far wall': s.air + 0.25 * (s.wall - s.air) };
    const lag = 1 - Math.exp(-1 / 60);
    for (const [name, p] of Object.entries(this.probes)) {
      let t = truth[name];
      if (p.hand > 0) { t = 33; p.hand -= 1; }
      p.sensed = p.sensed == null ? t : p.sensed + (t - p.sensed) * lag;
    }
    this.elapsed += 1;
    this.time += 1000;
    if (this.elapsed % 10 === 0) this._record();
  }

  readings() {
    const out = {};
    for (const [name, p] of Object.entries(this.probes)) {
      if (p.unplugged) { out[name] = { temp: null, status: 'disconnected' }; continue; }
      out[name] = { temp: Math.round((p.sensed + p.offset + gauss(this.rand) * 0.03) / STEP) * STEP, status: 'ok' };
    }
    return out;
  }

  _record() {
    const r = this.readings();
    const temps = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.temp]));
    this.samples.push({ t: this.time, temps });
    if (this.samples.length > 8640) this.samples.shift();
    const amb = AMBIENT.map(n => temps[n]).filter(v => v != null);
    if (!amb.length) return;
    const room = median(amb);
    this.roomTrace.push({ t: this.time, room });
    while (this.roomTrace.length && this.time - this.roomTrace[0].t > 600e3) this.roomTrace.shift();
    this._rules(r, temps, room);
  }

  _slope(seconds) {
    const pts = this.roomTrace.filter(p => this.time - p.t <= seconds * 1000);
    if (pts.length < 6) return 0;
    const t0 = pts[0].t, xs = pts.map(p => (p.t - t0) / 60e3), ys = pts.map(p => p.room);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let sxx = 0, sxy = 0;
    xs.forEach((x, i) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (ys[i] - my); });
    return sxx ? sxy / sxx : 0;
  }

  // Simple rules standing in for the real detector.
  _rules(r, temps, room) {
    const now = new Date(this.time).toISOString();
    const rate = this._slope(180);
    const active = new Map();
    const open = (key, kind, severity, message, advice, evidence = {}) =>
      active.set(key, { kind, severity, message, recommendations: [advice], evidence, opened_at: this.issues.get(key)?.opened_at || now });

    for (const [name, v] of Object.entries(r)) {
      if (v.status !== 'ok') open(`fault:${name}`, 'SENSOR_FAULT', 'WARNING', `${name} sensor is not responding (reads -127)`, `Check the ${name} probe's wiring (power, data and ground).`);
    }
    const gapWin = (temps.Window ?? room) - room, gapDoor = (temps.Door ?? room) - room;
    const fast = rate < -0.08;
    this.fastFor = fast ? (this.fastFor || 0) + 10 : 0;
    const minutes = rate < 0 && room > MIN_C ? (room - MIN_C) / -rate : null;
    const forecast = minutes != null && minutes <= 120 ? `; below ${MIN_C} °C in about ${minutes < 15 ? Math.max(1, Math.round(minutes)) : 5 * Math.round(minutes / 5)} min` : '';
    if (this.fastFor >= 120) {
      const side = gapWin < -3 ? 'Window' : gapDoor < -1.5 ? 'Door' : null;
      const where = side ? `cold air from the ${side} side` : 'the whole room, not one side';
      const advice = side === 'Window' ? 'Close the window.' : side === 'Door' ? 'Close the door.' : 'Check the heating and look for openings.';
      open('fast', 'FAST_COOLING', minutes != null && minutes < 15 ? 'CRITICAL' : 'WARNING',
        `Room cooling ${(-rate).toFixed(2)} °C/min, faster than normal: ${where}${forecast}`, advice,
        { side, rate_c_per_min: rate, forecast_minutes: minutes, forecast_limit_c: MIN_C });
    }
    if (room < MIN_C) open('cold', 'TOO_COLD', 'WARNING', `Room went below the ${MIN_C} °C limit (now ${room.toFixed(1)} °C)`, 'Turn the heating up and close any open windows or doors.');
    if (this.controls.heater === 'off' && room < this.controls.setpoint_c - 1 && rate < 0)
      open('heater', 'HEATING_OFF', 'WARNING', `The heater looks off while the room is ${room.toFixed(1)} °C and falling${forecast}`, 'Check the heater: is it switched on and powered?');
    this.issues = active;
    this.metricTrace.push({ t: this.time, rate });
    if (this.metricTrace.length > 8640) this.metricTrace.shift();
  }

  state() {
    return {
      deviceId: this.deviceId,
      mode: 'preview',
      time: new Date(this.time),
      sensors: this.readings(),
      issues: [...this.issues.values()],
      controls: { ...this.controls },
      heaterRunning: this.s.running,
      speed: this.speed,
      live: true,
    };
  }

  async history(minutes) {
    const from = this.time - minutes * 60e3;
    const bucket = minutes <= 60 ? 10 : 60;
    const points = [];
    let acc = null;
    for (const h of this.samples) {
      if (h.t < from) continue;
      const b = Math.floor(h.t / (bucket * 1000));
      if (!acc || acc.b !== b) { if (acc) points.push(acc.p); acc = { b, p: { time: new Date(h.t).toISOString(), ...h.temps } }; }
    }
    if (acc) points.push(acc.p);
    return { bucket_seconds: bucket, points };
  }

  async metrics(minutes) {
    const from = this.time - minutes * 60e3;
    return { series: { rate_c_per_min: this.metricTrace.filter(m => m.t >= from).map(m => ({ time: new Date(m.t).toISOString(), value: m.rate })) } };
  }
}
