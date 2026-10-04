import { ApiError } from './account.js';

// The real thing: the Room Sentinel API (backend/src/sentinel). Sign in (account.js), then poll.
//   GET  /latest, /issues                   -> live readings and open issues with advice
//   GET  /history, /metrics                 -> charts
//   GET/POST /demo/{id}/...                 -> demo controls (demo devices only)

export class BackendSource {
  constructor(baseUrl) {
    this.kind = 'backend';
    this.base = baseUrl.replace(/\/+$/, '');
    this.token = null;
    this.deviceId = null;
    this.devices = [];
    this.latest = {};
    this.issues = [];
    this.demo = null;
    this.scenarios = [];
    this.error = null;
  }

  async _fetch(path, options = {}) {
    const response = await fetch(this.base + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(options.headers || {}) },
      signal: AbortSignal.timeout(20000), // the deployed server may need a moment to wake up
    });
    if (!response.ok) {
      let detail = `${response.status}`;
      try { detail = (await response.json()).detail || detail; } catch { /* not JSON */ }
      throw new ApiError(typeof detail === 'string' ? detail : JSON.stringify(detail), response.status);
    }
    return response.status === 204 ? null : response.json();
  }

  /** Start with a token from the sign-in screen (account.js). */
  async connect(token) {
    this.token = token;
    await this.refresh();
    this.devices = Object.entries(this.latest).map(([id, r]) => ({ id, mode: r.mode }));
    this.deviceId = (this.devices.find(d => d.mode === 'device') || this.devices[0] || {}).id || null;
    if (this.deviceId) await this.refresh(); // now that a device is chosen, also fetch its demo state
    try { this.scenarios = Object.keys(await this._fetch('/demo/scenarios')); } catch { this.scenarios = []; }
  }

  async refresh() {
    const latest = await this._fetch('/latest');
    this.latest = latest && !latest.error ? latest : {};
    this.issues = await this._fetch('/issues');
    const current = this.latest[this.deviceId];
    this.demo = current?.mode === 'demo' ? await this._fetch(`/demo/${encodeURIComponent(this.deviceId)}`) : null;
    this.error = null;
  }

  state() {
    const r = this.latest[this.deviceId];
    if (!r) return null;
    const sensors = Object.fromEntries(Object.entries(r.sensors).map(([n, v]) => [n, { temp: v.temp, status: v.status }]));
    return {
      deviceId: this.deviceId,
      mode: r.mode,
      time: new Date(r.time),
      sensors,
      issues: this.issues.filter(i => i.device_id === this.deviceId),
      controls: this.demo?.controls || null,
      heaterRunning: this.demo ? this.demo.heater_running : null,
      speed: this.demo?.speed ?? 1,
      live: r.live,
    };
  }

  isDemo() { return this.latest[this.deviceId]?.mode === 'demo'; }

  async setControls(change) {
    if (!this.isDemo()) return;
    const id = encodeURIComponent(this.deviceId);
    const probe = ['unplug', 'plug', 'hand'].find(k => k in change);
    this.demo = probe
      ? await this._fetch(`/demo/${id}/probe`, { method: 'POST', body: JSON.stringify({ sensor: change[probe], action: probe }) })
      : await this._fetch(`/demo/${id}/controls`, { method: 'POST', body: JSON.stringify(change) });
  }
  async setSpeed(speed) {
    if (this.isDemo()) this.demo = await this._fetch(`/demo/${encodeURIComponent(this.deviceId)}/run`, { method: 'POST', body: JSON.stringify({ speed }) });
  }
  async startScenario(name) {
    if (this.isDemo()) this.demo = await this._fetch(`/demo/${encodeURIComponent(this.deviceId)}/scenario`, { method: 'POST', body: JSON.stringify({ name }) });
  }
  async reset() {
    if (this.isDemo()) this.demo = await this._fetch(`/demo/${encodeURIComponent(this.deviceId)}/reset`, { method: 'POST' });
  }
  history(minutes) {
    return this._fetch(`/history?device=${encodeURIComponent(this.deviceId)}&minutes=${minutes}`);
  }
  metrics(minutes) {
    return this._fetch(`/metrics?device=${encodeURIComponent(this.deviceId)}&minutes=${minutes}&names=rate_c_per_min,expected_rate_c_per_min`);
  }
}
