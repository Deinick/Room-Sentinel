import { RoomScene } from './scene.js';
import { PreviewSource } from './preview.js';
import { BackendSource } from './backend.js';
import { PlanView } from './plan.js';
import { ApiError, DEFAULT_API, PASSWORD_RULE, accountApi, pairingCodeFromUrl, validEmail, validPassword } from './account.js';
import { AMBIENT, SENSORS, SENSOR_NAMES } from './layout.js';
import { COLOR_SPAN, cssColor } from './field.js';

const gsap = window.gsap;
// Animations finish on time even when frames are slow (weak laptop, busy GPU); otherwise GSAP
// stretches them and the interface could stay invisible for seconds after loading.
gsap.ticker.lagSmoothing(0);
const $ = id => document.getElementById(id);
const SENSOR_COLORS = { Centre: '#e8eef6', Window: '#6fb8ff', Heater: '#ff9a5c', Door: '#7ee2b8', 'Far wall': '#c9a8ff' };
const median = v => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: not remembered */ } },
};
// The sign-in token lives for this browser tab only.
const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* not kept */ } },
};

// Sensor positions moved on the 2D plan are remembered in this browser.
const DEFAULT_POSITIONS = Object.fromEntries(SENSOR_NAMES.map(n => [n, [...SENSORS[n].pos]]));
try {
  const saved = JSON.parse(store.get('sensor-positions') || 'null');
  for (const n of SENSOR_NAMES) if (Array.isArray(saved?.[n]) && saved[n].length === 3 && saved[n].every(Number.isFinite)) SENSORS[n].pos = saved[n];
} catch { /* defaults */ }

// ------------------------------------------------------------------ state

let source = new PreviewSource();
let state = null;
const smooth = {}; // displayed temperature per sensor, eased towards the latest reading
const trace = []; // {time ms (data clock), room} for the trend
let target = 21;
let targetTouched = false;
let shownIssues = new Set();
let historyMinutes = 60;
let lastUi = 0;
let polling = false;

let account = null; // {api, token, email} when signed in

const scene = new RoomScene($('scene'), { onSensorClick: name => { openPanel('sensors'); scene.flyToSensor(name); highlightSensor(name); } });
const plan = new PlanView({
  onMove: (name, x, z) => {
    SENSORS[name].pos = [x, SENSORS[name].pos[1], z];
    scene.moveSensor(name);
    store.set('sensor-positions', JSON.stringify(Object.fromEntries(SENSOR_NAMES.map(n => [n, SENSORS[n].pos]))));
  },
  onSelect: name => highlightSensor(name),
});

// ------------------------------------------------------------------ boot

(async function boot() {
  try {
    await scene.load('../room.glb', f => { $('loader-progress').style.width = `${Math.round(f * 100)}%`; });
  } catch (e) {
    $('loader-text').textContent = 'Could not load the room. Serve this folder over http (see README).';
    console.error(e);
    return;
  }
  $('loader-progress').style.width = '100%';
  $('loader').classList.add('done');
  fillScenarios();
  setMode();
  renderAccount();
  // Links can start straight into a story, e.g. ?scenario=window_open&view=window&outside=-5
  // (those skip the sign-in screen and run the offline demo).
  const params = new URLSearchParams(location.search);
  if (params.has('outside')) source.setControls({ outside_c: Number(params.get('outside')) });
  if (params.has('window')) source.setControls({ window: params.get('window') });
  if (params.has('scenario')) source.startScenario(params.get('scenario'));
  const storyLink = ['offline', 'outside', 'window', 'scenario', 'view', 'panel', 'plan'].some(k => params.has(k));
  if (storyLink && !pendingCode) {
    enterApp(params.get('view') || 'overview');
    if (params.has('panel')) setTimeout(() => openPanel(params.get('panel')), 1200);
    if (params.has('plan')) setTimeout(() => setDimension('2d'), 900);
  } else if (!(await resumeSession())) {
    showAuth();
  }
  let last = performance.now();
  (function loop(now) {
    const dt = (now - last) / 1000;
    last = now;
    step(dt, now);
    requestAnimationFrame(loop);
  })(last);
})();

function step(dt, now) {
  if (source.kind === 'preview') {
    source.tick(dt);
    state = source.state();
  } else if (!polling && now - (step.lastPoll || 0) > 1000) {
    step.lastPoll = now;
    poll();
  }
  if (!state) return;

  // ease the displayed values so nothing jumps when a reading arrives
  const k = 1 - Math.exp(-dt / 0.45);
  for (const name of SENSOR_NAMES) {
    const t = state.sensors[name]?.temp;
    if (t == null) { smooth[name] = null; continue; }
    smooth[name] = smooth[name] == null ? t : smooth[name] + (t - smooth[name]) * k;
  }
  const ambient = AMBIENT.map(n => smooth[n]).filter(v => v != null);
  const room = ambient.length ? median(ambient) : null;
  if (state.controls && !targetTouched) setTarget(state.controls.setpoint_c, false);
  scene.setState({ temps: smooth, controls: state.controls, target, room, heaterRunning: state.heaterRunning });
  plan.update({ sources: scene.sources, temps: smooth, target });

  const t = state.time.getTime();
  const rawAmbient = AMBIENT.map(n => state.sensors[n]?.temp).filter(v => v != null);
  if (rawAmbient.length && (!trace.length || t - trace[trace.length - 1].time >= 5000)) {
    trace.push({ time: t, room: median(rawAmbient) });
    while (trace.length && t - trace[0].time > 600e3) trace.shift();
  }
  if (now - lastUi > 250) { lastUi = now; renderUi(room); }
}

async function poll() {
  polling = true;
  try {
    await source.refresh();
    state = source.state();
    if (!state) setStatus('Connected, but this device has no data yet.');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { signOut('Your session has expired. Please sign in again.'); return; }
    setStatus(`Connection problem: ${e.message}. Showing the last values.`);
  } finally {
    polling = false;
  }
}

// ------------------------------------------------------------------ HUD and labels

function trendPerMinute() {
  if (trace.length < 6) return null;
  const end = trace[trace.length - 1].time;
  const pts = trace.filter(p => end - p.time <= 180e3);
  if (pts.length < 6) return null;
  const xs = pts.map(p => (p.time - pts[0].time) / 60e3), ys = pts.map(p => p.room);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxx = 0, sxy = 0;
  xs.forEach((x, i) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (ys[i] - my); });
  return sxx ? sxy / sxx : null;
}

function renderUi(room) {
  $('hud-temp').textContent = room == null ? '--.-' : room.toFixed(1);
  const rate = trendPerMinute();
  const trend = $('hud-trend');
  if (state.waiting) { trend.textContent = '—'; trend.className = 'trend'; }
  else if (rate == null) { trend.textContent = 'Measuring…'; trend.className = 'trend'; }
  else if (Math.abs(rate) < 0.01) { trend.textContent = 'Stable'; trend.className = 'trend'; }
  else { trend.textContent = `${rate > 0 ? '↑ +' : '↓ '}${rate.toFixed(2)} °C/min`; trend.className = `trend ${rate > 0 ? 'up' : 'down'}`; }

  const issues = state.issues || [];
  const serious = issues.filter(i => i.severity !== 'INFO');
  const status = $('hud-status');
  const note = $('hud-note');
  if (state.waiting) {
    note.textContent = `Waiting for ${source.deviceName()} to send readings. Check that it's powered and on Wi-Fi.`;
    note.dataset.action = 'devices';
  } else if (account && !account.devices.length) {
    note.textContent = 'This is the demo room. Pair a device to see your own →';
    note.dataset.action = 'devices';
  } else note.textContent = '';
  note.hidden = !note.textContent;
  if (state.waiting) { status.textContent = 'Waiting'; status.className = 'status warn'; }
  else if (!state.live) { status.textContent = 'Offline'; status.className = 'status warn'; }
  else if (serious.some(i => i.severity === 'CRITICAL')) { status.textContent = 'Critical'; status.className = 'status crit'; }
  else if (serious.length) { status.textContent = 'Warning'; status.className = 'status warn'; }
  else { status.textContent = 'Normal'; status.className = 'status ok'; }

  const withForecast = issues.find(i => i.evidence?.forecast_minutes != null);
  const forecast = $('hud-forecast');
  if (withForecast) {
    const m = withForecast.evidence.forecast_minutes;
    const about = m < 15 ? Math.max(1, Math.round(m)) : 5 * Math.round(m / 5);
    forecast.innerHTML = `Below <b>${withForecast.evidence.forecast_limit_c} °C</b> in about <b>${about} min</b><br><span style="color:var(--text-2)">${withForecast.recommendations?.[0] || ''}</span>`;
    forecast.hidden = false;
  } else forecast.hidden = true;

  $('hud-outside').textContent = state.controls ? `${state.controls.outside_c.toFixed(0)} °C` : '—';
  const heaterOn = state.heaterRunning ?? (smooth.Heater != null && room != null && smooth.Heater - room > 4);
  $('hud-heater').textContent = heaterOn ? 'Heating' : 'Idle';
  const ok = SENSOR_NAMES.filter(n => state.sensors[n]?.status === 'ok').length;
  $('hud-sensors').textContent = `${ok} / ${SENSOR_NAMES.length}`;

  scene.updateLabels();
  renderSensors();
  renderIssues(issues);
  syncControls();
}

// ------------------------------------------------------------------ panels

let openName = null;
document.querySelectorAll('.rail-btn').forEach(btn => btn.addEventListener('click', () => {
  const name = btn.dataset.panel;
  if (openName === name) closePanel(); else openPanel(name);
}));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closePanel));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

function openPanel(name) {
  if (openName === name) return;
  const prev = openName && $(`panel-${openName}`);
  if (prev) { gsap.killTweensOf(prev); prev.hidden = true; }
  openName = name;
  const el = $(`panel-${name}`);
  el.hidden = false;
  gsap.fromTo(el, { opacity: 0, x: -28, scale: 0.975, filter: 'blur(6px)' }, { opacity: 1, x: 0, scale: 1, filter: 'blur(0px)', duration: 0.65, ease: 'power3.out' });
  gsap.from(el.querySelectorAll('.sensor-card, .issue-card, .chart-card, .toggle, .field, .input, .segmented, .primary'), { opacity: 0, y: 10, duration: 0.5, ease: 'power3.out', stagger: 0.035, delay: 0.08 });
  document.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  if (name === 'history') loadHistory();
}

function closePanel() {
  if (!openName) return;
  const el = $(`panel-${openName}`);
  openName = null;
  document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'));
  gsap.to(el, { opacity: 0, x: -20, scale: 0.98, filter: 'blur(4px)', duration: 0.4, ease: 'power2.in', onComplete: () => { el.hidden = true; } });
}

// sensors
let sensorsKey = '';
function renderSensors() {
  const key = SENSOR_NAMES.map(n => `${smooth[n]?.toFixed(1)}:${state.sensors[n]?.status}`).join('|') + target;
  if (key === sensorsKey) return;
  sensorsKey = key;
  $('sensor-list').innerHTML = SENSOR_NAMES.map(name => {
    const s = state.sensors[name] || { status: 'missing' };
    const t = smooth[name];
    const ok = s.status === 'ok' && t != null;
    return `<button class="sensor-card" data-sensor="${name}">
      <div class="sensor-top"><span class="sensor-name">${SENSORS[name].label}</span><span class="sensor-temp" style="color:${ok ? cssColor(t, target) : 'var(--crit)'}">${ok ? `${t.toFixed(1)}°` : '—'}</span></div>
      <div class="sensor-meta"><span class="${ok ? '' : 'bad'}">${ok ? 'Reporting' : s.status.replace('_', ' ')}</span><span>${SENSORS[name].note}</span></div>
    </button>`;
  }).join('');
  $('sensor-list').querySelectorAll('.sensor-card').forEach(c => c.addEventListener('click', () => { scene.flyToSensor(c.dataset.sensor); highlightSensor(c.dataset.sensor); }));
}
function highlightSensor(name) {
  const card = $('sensor-list').querySelector(`[data-sensor="${CSS.escape(name)}"]`);
  if (card) gsap.fromTo(card, { boxShadow: '0 0 0 1px rgba(185,220,255,.9), 0 0 28px rgba(111,184,255,.45)' }, { boxShadow: '0 0 0 0 rgba(0,0,0,0)', duration: 1.6, ease: 'power2.out' });
}

// insights + toasts
let issuesKey = '';
function renderIssues(issues) {
  const visible = issues.filter(i => i.severity !== 'INFO' || openName === 'insights');
  const badge = $('insights-badge');
  const count = issues.filter(i => i.severity !== 'INFO').length;
  badge.hidden = !count;
  badge.textContent = count;

  const key = JSON.stringify(issues.map(i => [i.kind, i.severity, i.message, i.recommendations]));
  if (key !== issuesKey) {
    issuesKey = key;
    $('issue-list').innerHTML = issues.length ? issues.map(i => `
      <div class="issue-card">
        <div class="issue-kind ${i.severity}">${i.kind.replace(/_/g, ' ')}</div>
        <div class="issue-msg">${escapeHtml(i.message)}</div>
        ${i.recommendations?.length ? `<div class="issue-advice">${escapeHtml(i.recommendations[0])}</div>` : ''}
        <div class="issue-time">Since ${new Date(i.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>`).join('') : '<div class="empty">All good. Nothing needs your attention.</div>';
    $('insights-sub').textContent = source.kind === 'preview'
      ? 'Offline preview: simple rules standing in for the real detector.'
      : 'From the Room Sentinel detector, with what to do about it.';
  }

  // a toast for each new problem
  const keys = new Set(visible.map(i => `${i.kind}:${i.sensor || ''}`));
  for (const i of visible) {
    const k = `${i.kind}:${i.sensor || ''}`;
    if (!shownIssues.has(k) && i.severity !== 'INFO') toast(i);
  }
  shownIssues = keys;
}

function toast(issue) {
  const el = document.createElement('div');
  el.className = 'toast glass';
  el.innerHTML = `<div class="toast-kind ${issue.severity}">${issue.kind.replace(/_/g, ' ')}</div>
    <div class="toast-msg">${escapeHtml(issue.message)}</div>
    ${issue.recommendations?.[0] ? `<div class="toast-advice">${escapeHtml(issue.recommendations[0])}</div>` : ''}`;
  el.addEventListener('click', () => openPanel('insights'));
  const box = $('toasts');
  box.prepend(el);
  while (box.children.length > 2) box.lastChild.remove();
  gsap.fromTo(el, { opacity: 0, y: -12, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.6)' });
  gsap.to(el, { opacity: 0, y: -8, duration: 0.5, delay: 9, ease: 'power2.in', onComplete: () => el.remove() });
  if (issue.evidence?.side === 'Window') scene.flyTo('window', 1.8);
  else if (issue.evidence?.side === 'Door') scene.flyTo('door', 1.8);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ------------------------------------------------------------------ history charts

document.querySelectorAll('#history-range button').forEach(b => b.addEventListener('click', () => {
  historyMinutes = Number(b.dataset.minutes);
  document.querySelectorAll('#history-range button').forEach(x => x.classList.toggle('active', x === b));
  loadHistory();
}));
setInterval(() => { if (openName === 'history') loadHistory(); }, 10000);

async function loadHistory() {
  try {
    const [h, m] = await Promise.all([source.history(historyMinutes), source.metrics(historyMinutes)]);
    drawTemps(h.points || []);
    drawRates(m.series || {});
    $('history-note').textContent = `${(h.points || []).length} points · one every ${h.bucket_seconds || '?'} s${source.kind === 'preview' ? ' · offline preview' : ''}`;
  } catch (e) {
    $('history-note').textContent = `Could not load history: ${e.message}`;
  }
}

function scaleFor(values, pad) {
  const v = values.filter(x => x != null && isFinite(x));
  if (!v.length) return null;
  let lo = Math.min(...v), hi = Math.max(...v);
  if (hi - lo < pad) { const c = (hi + lo) / 2; lo = c - pad / 2; hi = c + pad / 2; }
  return { lo, hi };
}

function path(points, x, y) {
  let d = '', pen = false;
  for (const p of points) {
    if (p.v == null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

function drawTemps(points) {
  const svg = $('chart-temps');
  if (!points.length) { svg.innerHTML = '<text x="160" y="85" text-anchor="middle">No data yet</text>'; return; }
  const W = 320, H = 170, L = 26, B = 16;
  const times = points.map(p => Date.parse(p.time));
  const t0 = Math.min(...times), t1 = Math.max(...times) || t0 + 1;
  const names = SENSOR_NAMES.filter(n => n !== 'Heater');
  const sc = scaleFor(points.flatMap(p => names.map(n => p[n])), 2);
  const x = t => L + (t - t0) / Math.max(1, t1 - t0) * (W - L - 4);
  const y = v => 6 + (1 - (v - sc.lo) / (sc.hi - sc.lo)) * (H - B - 10);
  const grid = [0, 0.5, 1].map(f => { const v = sc.lo + f * (sc.hi - sc.lo); return `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.08)"/><text x="0" y="${y(v) + 3}">${v.toFixed(1)}</text>`; }).join('');
  const lines = names.map(n => `<path d="${path(points.map((p, i) => ({ t: times[i], v: p[n] })), x, y)}" fill="none" stroke="${SENSOR_COLORS[n]}" stroke-width="${n === 'Centre' ? 2 : 1.3}" stroke-linejoin="round" opacity=".95"/>`).join('');
  const targetLine = target >= sc.lo && target <= sc.hi ? `<line x1="${L}" x2="${W}" y1="${y(target)}" y2="${y(target)}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 4"/>` : '';
  svg.innerHTML = grid + targetLine + lines;
  $('chart-legend').innerHTML = names.map(n => `<span style="color:${SENSOR_COLORS[n]}">${SENSORS[n].label}</span>`).join('');
}

function drawRates(series) {
  const svg = $('chart-rate');
  const measured = series.rate_c_per_min || [], expected = series.expected_rate_c_per_min || [];
  if (!measured.length) { svg.innerHTML = '<text x="160" y="60" text-anchor="middle">No data yet</text>'; return; }
  const W = 320, H = 120, L = 30;
  const all = [...measured, ...expected];
  const times = all.map(p => Date.parse(p.time));
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const sc = scaleFor(all.map(p => p.value).concat([0]), 0.1);
  const x = t => L + (t - t0) / Math.max(1, t1 - t0) * (W - L - 4);
  const y = v => 6 + (1 - (v - sc.lo) / (sc.hi - sc.lo)) * (H - 18);
  const toPts = s => s.map(p => ({ t: Date.parse(p.time), v: p.value }));
  svg.innerHTML = `<line x1="${L}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(255,255,255,.18)"/>
    <text x="0" y="${y(sc.hi) + 3}">${sc.hi.toFixed(2)}</text><text x="0" y="${y(sc.lo) + 3}">${sc.lo.toFixed(2)}</text>
    <path d="${path(toPts(expected), x, y)}" fill="none" stroke="#7cc4ff" stroke-width="1.4" stroke-dasharray="4 3"/>
    <path d="${path(toPts(measured), x, y)}" fill="none" stroke="#e8eef6" stroke-width="1.8"/>`;
  $('rate-legend').innerHTML = '<span style="color:#e8eef6">Measured (°C/min)</span>' +
    (expected.length ? '<span style="color:#7cc4ff">Expected for this room (dashed)</span>' : '<span class="muted">Expected rate comes from the backend detector</span>');
}

// ------------------------------------------------------------------ layers

const layerInputs = { heatmap: 'layer-heatmap', air: 'layer-air', volume: 'layer-volume', labels: 'layer-labels', rotate: 'layer-rotate' };
for (const [layer, id] of Object.entries(layerInputs)) {
  const input = $(id);
  const saved = store.get(`layer-${layer}`);
  if (saved != null) input.checked = saved === '1';
  input.addEventListener('change', () => { store.set(`layer-${layer}`, input.checked ? '1' : '0'); applyLayers(); });
}
function applyLayers() {
  scene.setLayers(Object.fromEntries(Object.entries(layerInputs).map(([l, id]) => [l, $(id).checked])));
}
applyLayers();

$('target').addEventListener('input', e => { targetTouched = true; setTarget(Number(e.target.value), true); });
function setTarget(value, fromUser) {
  target = value;
  if (!fromUser) $('target').value = value;
  $('target-value').textContent = `${value.toFixed(1)} °C`;
  $('scale-lo').textContent = `${(value - COLOR_SPAN).toFixed(0)}°`;
  $('scale-mid').textContent = `${value.toFixed(0)}°`;
  $('scale-hi').textContent = `${(value + COLOR_SPAN).toFixed(0)}°`;
}

// ------------------------------------------------------------------ dock: views and demo controls

document.querySelectorAll('#view-row button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#view-row button').forEach(x => x.classList.toggle('active', x === b));
  scene.flyTo(b.dataset.view);
}));

function segmented(id, onPick) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.addEventListener('click', async () => {
    document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('active', x === b));
    try { await onPick(b.dataset.v); } catch (e) { setStatus(`Could not change that: ${e.message}`); }
  }));
}
function setView(name) {
  document.querySelectorAll('#view-row button').forEach(x => x.classList.toggle('active', x.dataset.view === name));
  scene.flyTo(name);
}
segmented('window-select', async v => { setView('window'); await source.setControls({ window: v }); });
segmented('door-select', async v => { setView('door'); await source.setControls({ door_open: v === 'true' }); });
segmented('heater-select', async v => { setView('heater'); await source.setControls({ heater: v }); });
segmented('speed-select', async v => { await source.setSpeed(Number(v)); });

let outsideTimer = null;
$('outside').addEventListener('input', e => {
  $('outside-value').textContent = `${e.target.value} °C`;
  clearTimeout(outsideTimer);
  outsideTimer = setTimeout(() => source.setControls({ outside_c: Number(e.target.value) }).catch(err => setStatus(err.message)), 150);
});
$('scenario-select').addEventListener('change', async e => {
  if (!e.target.value) return;
  try { await source.startScenario(e.target.value); setStatus(`Scenario “${e.target.value.replace(/_/g, ' ')}” started.`); } catch (err) { setStatus(err.message); }
  e.target.value = '';
});
$('reset-btn').addEventListener('click', async () => {
  try { await source.reset(); trace.length = 0; setView('overview'); } catch (e) { setStatus(e.message); }
});

function fillScenarios() {
  $('scenario-select').innerHTML = '<option value="">Run a scenario…</option>' +
    (source.scenarios || []).map(s => `<option value="${s}">${s.replace(/_/g, ' ')}</option>`).join('');
}

// keep the controls showing what the room really is (a scenario can change them)
function syncControls() {
  const c = state.controls;
  $('demo-row').hidden = !c;
  if (!c) return;
  const pick = (id, v) => document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('active', b.dataset.v === String(v)));
  pick('window-select', c.window);
  pick('door-select', !!c.door_open);
  pick('heater-select', c.heater);
  pick('speed-select', state.speed);
  if (document.activeElement !== $('outside')) {
    $('outside').value = c.outside_c;
    $('outside-value').textContent = `${Math.round(c.outside_c)} °C`;
  }
}

// ------------------------------------------------------------------ gates: sign in, add a first device, pair
// Full-screen glass cards over the room. The flow:
//   not signed in            -> sign in / create account
//   signed in, QR link open  -> "Pair this device?" (…/room-view/#pair/CODE, from the device's QR code)
//   signed in, no devices    -> how to add one (waits for it), or explore the demo room
//   signed in, has devices   -> the room

const GATES = ['auth', 'onboard', 'pairing'];
let authMode = 'login';
let pendingCode = pairingCodeFromUrl();
let watchTimer = null;
let expiryTimer = null;
$('auth-api').value = store.get('api-url') || DEFAULT_API;
$('auth-email').value = store.get('api-email') || '';

function showGate(id) {
  document.body.classList.add('signing-in', 'ui-hidden');
  closePanel();
  setDimension('3d');
  for (const g of GATES) { $(g).hidden = g !== id; $(g).classList.remove('leaving'); }
  scene.flyTo('overview', 2.4);
  scene.setLayers({ rotate: true });
}

function showAuth(notice = '') {
  showGate('auth');
  setAuthMode('login');
  authMessage(notice || (pendingCode ? 'Sign in, or create an account, to add your device.' : ''), false);
  setTimeout(() => ($('auth-email').value ? $('auth-password') : $('auth-email')).focus({ preventScroll: true }), 400);
}

function enterApp(view = 'overview') {
  for (const g of GATES) {
    const el = $(g);
    if (el.hidden) continue;
    el.classList.add('leaving');
    setTimeout(() => { el.hidden = true; el.classList.remove('leaving'); }, 550);
  }
  clearInterval(expiryTimer);
  document.body.classList.remove('signing-in', 'ui-hidden');
  applyLayers(); // back to the user's own auto-rotate setting
  scene.flyTo(view, 2.4);
  document.querySelectorAll('#view-row [data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === view));
}

function setAuthMode(mode) {
  authMode = mode;
  const register = mode === 'register';
  $('auth-title').textContent = register ? 'Create your account' : 'Welcome back';
  $('auth-sub').textContent = register ? 'One account for the website and the app.' : 'Sign in to see your room live.';
  $('auth-confirm-field').hidden = !register;
  $('auth-password').autocomplete = register ? 'new-password' : 'current-password';
  $('auth-submit').innerHTML = `${register ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span>`;
  $('auth-switch-text').textContent = register ? 'Already have an account?' : 'New to Room Sentinel?';
  $('auth-mode').textContent = register ? 'Sign in' : 'Create an account';
  $('auth-error').hidden = true;
}

function authMessage(text, isError) {
  const el = $(isError ? 'auth-error' : 'auth-notice');
  $(isError ? 'auth-notice' : 'auth-error').hidden = true;
  el.textContent = text;
  el.hidden = !text;
  if (text && isError) gsap.fromTo('#auth .auth-card', { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.35)' });
}

$('auth-mode').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
$('auth-reveal').addEventListener('click', () => {
  const show = $('auth-password').type === 'password';
  $('auth-password').type = $('auth-confirm').type = show ? 'text' : 'password';
  $('auth-reveal').textContent = show ? 'Hide' : 'Show';
});
$('auth-offline').addEventListener('click', () => {
  if (account) signOut('', false);
  usePreview();
  enterApp();
});

$('auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('auth-email').value.trim().toLowerCase();
  const password = $('auth-password').value;
  if (!validEmail(email)) return authMessage('Enter a valid email address.', true);
  if (!validPassword(password)) return authMessage(`Password must be ${PASSWORD_RULE}`, true);
  if (authMode === 'register' && password !== $('auth-confirm').value) return authMessage('The passwords do not match.', true);
  const button = $('auth-submit');
  button.disabled = true;
  const api = accountApi($('auth-api').value.trim() || DEFAULT_API);
  try {
    if (authMode === 'register') {
      authMessage('Creating your account… (the server may take a moment to wake up)', false);
      await api.register(email, password);
      $('auth-password').value = $('auth-confirm').value = '';
      setAuthMode('login');
      authMessage('Account created. Sign in with your email and password.', false);
    } else {
      authMessage('Signing in… (the server may take a moment to wake up)', false);
      const token = await api.token(email, password);
      const user = await api.currentUser(token);
      store.set('api-url', api.base);
      store.set('api-email', user.email);
      $('auth-password').value = '';
      await startSession(api, token, user.email);
    }
  } catch (err) {
    authMessage(err.message || 'Could not complete the request.', true);
  } finally {
    button.disabled = false;
  }
});

/** Signed in: load the account's devices, then go wherever the flow says. */
async function startSession(api, token, email) {
  account = { api, token, email, devices: [] };
  session.set('token', token);
  session.set('api', api.base);
  session.set('email', email);
  await loadDevices();
  renderAccount();
  await route();
}

async function loadDevices() {
  account.devices = await account.api.devices(account.token);
  renderDevices();
}

async function route(preferred = null) {
  if (pendingCode) return showPairing(pendingCode);
  if (!account.devices.length) return showOnboarding();
  stopWatching();
  await connectRooms({ preferred });
  enterApp();
}

/** Live data for the account's devices, or the shared demo room. */
async function connectRooms({ demo = false, preferred = null } = {}) {
  const backend = new BackendSource(account.api.base);
  try {
    await backend.connect(account.token, { owned: account.devices, demo, preferred });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return signOut('Your session has expired. Please sign in again.');
    backend.devices = [];
    setStatus(`Room data isn't available right now (${e.message}).`);
  }
  if (backend.devices.length) {
    source = backend;
    state = source.state();
    setStatus(demo ? 'This is the shared demo room.' : `Connected · ${backend.devices.length} device(s).`);
  } else {
    usePreview(); // asked for the demo, but the server has none: the offline demo instead
  }
  resetView();
  fillDevices();
  fillScenarios();
  setMode();
  renderAccount();
  renderDevices();
}

// ------------------------------------------------------------------ no device yet

function showOnboarding() {
  showGate('onboard');
  $('onboard-email').textContent = `Signed in as ${account.email}`;
  watchForDevices();
}

/** Checks every few seconds whether a device got paired (on the phone, or in another tab). */
function watchForDevices() {
  stopWatching();
  watchTimer = setInterval(async () => {
    if (!account) return stopWatching();
    try {
      const list = await account.api.devices(account.token);
      if (!list.length) return;
      account.devices = list;
      stopWatching();
      await connectRooms({ preferred: list[0].device_id });
      enterApp();
      toast({ kind: 'DEVICE_PAIRED', severity: 'INFO', message: `${list[0].name || list[0].device_id} is now on your account.`, recommendations: ['Readings appear as soon as it connects.'] }, true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOut('Your session has expired. Please sign in again.');
    }
  }, 5000);
}
function stopWatching() { clearInterval(watchTimer); watchTimer = null; }

$('onboard-demo').addEventListener('click', async () => {
  await connectRooms({ demo: true });
  enterApp();
  watchForDevices(); // keep an eye out: pairing on the phone switches to the real room
});
$('onboard-signout').addEventListener('click', () => signOut(''));

// ------------------------------------------------------------------ pairing (QR link from the device)

function pairMessage(text, isError = false) {
  const el = $('pair-msg');
  el.textContent = text;
  el.className = `form-msg${isError ? ' error' : ''}`;
  el.hidden = !text;
}

async function showPairing(code) {
  showGate('pairing');
  stopWatching();
  $('pair-email').textContent = `Signed in as ${account.email}`;
  $('pair-title').textContent = 'Pair this device?';
  $('pair-serial').textContent = '…';
  $('pair-confirm').disabled = true;
  $('pair-confirm').textContent = 'Pair device';
  $('pair-expiry').textContent = '';
  pairMessage('Checking the code…');
  try {
    const info = await account.api.pairingInfo(account.token, code);
    $('pair-serial').textContent = info.device_id;
    pairMessage('');
    $('pair-confirm').disabled = false;
    startExpiry(new Date(info.expires_at));
  } catch (e) {
    $('pair-serial').textContent = '—';
    if (e instanceof ApiError && e.status === 401) return signOut('Your session has expired. Please sign in again.');
    pairMessage(pairingError(e), true);
  }
}

function pairingError(e) {
  if (e.status === 410) return 'This code has expired. On the device, open Account Login again for a new QR code.';
  if (e.status === 404) return 'This code was already used, or doesn\'t exist. On the device, open Account Login again.';
  return e.message;
}

function startExpiry(expires) {
  clearInterval(expiryTimer);
  const tick = () => {
    const left = Math.max(0, Math.round((expires - Date.now()) / 1000));
    $('pair-expiry').textContent = left ? `Code valid for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '';
    if (!left) {
      clearInterval(expiryTimer);
      $('pair-confirm').disabled = true;
      pairMessage('This code has expired. On the device, open Account Login again for a new QR code.', true);
    }
  };
  tick();
  expiryTimer = setInterval(tick, 1000);
}

function clearPendingCode() {
  pendingCode = null;
  if (location.hash.startsWith('#pair/') || new URLSearchParams(location.search).has('pair')) {
    const params = new URLSearchParams(location.search);
    params.delete('pair');
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''));
  }
}

$('pair-confirm').addEventListener('click', async () => {
  const code = pendingCode, serial = $('pair-serial').textContent;
  $('pair-confirm').disabled = true;
  pairMessage('Pairing…');
  try {
    await account.api.confirmPairing(account.token, code);
    clearInterval(expiryTimer);
    clearPendingCode();
    $('pair-title').textContent = 'Paired';
    $('pair-expiry').textContent = '';
    pairMessage('Your device is on your account. It connects by itself in a few seconds.');
    await loadDevices();
    setTimeout(() => route(serial), 1400);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return signOut('Your session has expired. Please sign in again.');
    pairMessage(pairingError(e), true);
  }
});
$('pair-cancel').addEventListener('click', () => { clearInterval(expiryTimer); clearPendingCode(); route(); });

// Opening another QR link in the same tab
window.addEventListener('hashchange', () => {
  const code = pairingCodeFromUrl();
  if (!code) return;
  pendingCode = code;
  account ? showPairing(code) : showAuth();
});

/** Back in the same tab: reuse the token if the server still accepts it. */
async function resumeSession() {
  const token = session.get('token'), base = session.get('api');
  if (!token || !base) return false;
  try {
    const api = accountApi(base);
    const user = await api.currentUser(token);
    await startSession(api, token, user.email);
    return true;
  } catch {
    session.set('token', null);
    return false;
  }
}

function signOut(notice = '', showScreen = true) {
  account = null;
  stopWatching();
  clearInterval(expiryTimer);
  session.set('token', null);
  usePreview();
  renderAccount();
  renderDevices();
  if (showScreen) showAuth(notice);
}

// ------------------------------------------------------------------ account panel

function renderAccount() {
  $('account-offline').hidden = !!account;
  $('account-online').hidden = !account;
  if (!account) return;
  $('account-email').textContent = account.email;
  $('account-server').textContent = account.api.base.replace(/^https?:\/\//, '');
  $('account-avatar').textContent = account.email.slice(0, 2).toUpperCase();
}

$('account-signin').addEventListener('click', () => showAuth());
$('signout-btn').addEventListener('click', () => signOut('You are signed out.'));

function formMessage(id, text, isError) {
  const el = $(id);
  el.textContent = text;
  el.className = `form-msg${isError ? ' error' : ''}`;
  el.hidden = !text;
}

$('password-form').addEventListener('submit', async e => {
  e.preventDefault();
  const current = $('pw-current').value, next = $('pw-new').value, again = $('pw-confirm').value;
  if (!current) return formMessage('pw-msg', 'Enter your current password.', true);
  if (!validPassword(next)) return formMessage('pw-msg', `New password must be ${PASSWORD_RULE}`, true);
  if (next !== again) return formMessage('pw-msg', 'The new passwords do not match.', true);
  if (next === current) return formMessage('pw-msg', 'Choose a different password from your current one.', true);
  $('pw-submit').disabled = true;
  formMessage('pw-msg', 'Updating…', false);
  try {
    // the current password is checked by signing in with it
    let verified;
    try { verified = await account.api.token(account.email, current); }
    catch (err) { if (err instanceof ApiError && (err.status === 401 || err.status === 400)) throw new Error('The current password is incorrect.'); throw err; }
    await account.api.changePassword(verified, next);
    for (const id of ['pw-current', 'pw-new', 'pw-confirm']) $(id).value = '';
    signOut('Password updated. Please sign in with your new password.');
  } catch (err) {
    formMessage('pw-msg', err.message, true);
  } finally {
    $('pw-submit').disabled = false;
  }
});

$('delete-start').addEventListener('click', () => { $('delete-start').hidden = true; $('delete-confirm').hidden = false; });
$('delete-no').addEventListener('click', () => { $('delete-start').hidden = false; $('delete-confirm').hidden = true; });
$('delete-yes').addEventListener('click', async () => {
  $('delete-yes').disabled = true;
  formMessage('delete-msg', '', false);
  try {
    await account.api.deleteAccount(account.token);
    $('delete-start').hidden = false;
    $('delete-confirm').hidden = true;
    signOut('Your account has been deleted.');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) signOut('Your session has expired. Please sign in again.');
    else formMessage('delete-msg', err.message, true);
  } finally {
    $('delete-yes').disabled = false;
  }
});

function fillDevices() {
  const devices = source.kind === 'backend' ? source.devices : [];
  $('device-field').hidden = devices.length < 2;
  $('device-select').innerHTML = devices.map(d => `<option value="${escapeHtml(d.id)}" ${d.id === source.deviceId ? 'selected' : ''}>${escapeHtml(d.name)}${d.mode === 'demo' ? ' · simulated' : ''}</option>`).join('');
}
$('device-select').addEventListener('change', e => showDevice(e.target.value));

async function showDevice(id) {
  if (source.kind !== 'backend') return;
  source.deviceId = id;
  resetView();
  await poll();
  fillDevices();
  setMode();
  renderDevices();
}

$('hud-note').addEventListener('click', () => openPanel('devices'));

// ------------------------------------------------------------------ devices panel (rename, limits, unpair)

function renderDevices() {
  const list = $('device-cards');
  if (!account) {
    $('devices-sub').textContent = 'Sign in to see and manage your devices.';
    list.innerHTML = '';
    return;
  }
  const devices = account.devices || [];
  $('devices-sub').textContent = devices.length ? `Paired to ${account.email}.` : 'No device on your account yet. Add one below.';
  const value = v => (v == null ? '' : v);
  list.innerHTML = devices.map(d => `
    <div class="device-card ${source.kind === 'backend' && source.deviceId === d.device_id ? 'current' : ''}" data-id="${escapeHtml(d.device_id)}">
      <div class="device-top"><b>${escapeHtml(d.name || 'Unnamed device')}</b><span class="device-serial">${escapeHtml(d.device_id)}</span></div>
      <label class="input"><span>Name</span><input data-f="name" maxlength="100" value="${escapeHtml(value(d.name))}" placeholder="e.g. Living room"></label>
      <div class="device-limits">
        <label class="input"><span>Min °C</span><input data-f="min_temperature" type="number" step="0.5" value="${value(d.min_temperature)}"></label>
        <label class="input"><span>Target °C</span><input data-f="target_temperature" type="number" step="0.5" value="${value(d.target_temperature)}"></label>
        <label class="input"><span>Max °C</span><input data-f="max_temperature" type="number" step="0.5" value="${value(d.max_temperature)}"></label>
      </div>
      <div class="device-actions">
        <button class="ghost" data-act="show">Show</button>
        <button class="ghost" data-act="save">Save</button>
        <button class="ghost danger" data-act="unpair">Unpair</button>
      </div>
      <p class="form-msg" hidden></p>
    </div>`).join('');
}

$('device-cards').addEventListener('click', async e => {
  const button = e.target.closest('button[data-act]');
  if (!button || !account) return;
  const card = button.closest('.device-card');
  const id = card.dataset.id;
  const device = account.devices.find(d => d.device_id === id);
  const msg = (text, isError) => { const p = card.querySelector('.form-msg'); p.textContent = text; p.className = `form-msg${isError ? ' error' : ''}`; p.hidden = !text; };
  try {
    if (button.dataset.act === 'show') {
      if (source.kind !== 'backend' || !source.devices.some(d => d.id === id)) await connectRooms({ preferred: id });
      else await showDevice(id);
      closePanel();
    } else if (button.dataset.act === 'save') {
      const changes = {};
      for (const input of card.querySelectorAll('input[data-f]')) {
        const f = input.dataset.f, raw = input.value.trim();
        const next = f === 'name' ? (raw || null) : (raw === '' ? null : Number(raw));
        if (next !== (device[f] ?? null)) changes[f] = next;
      }
      if (changes.name === null) return msg('A device needs a name.', true);
      const lo = changes.min_temperature !== undefined ? changes.min_temperature : device.min_temperature;
      const hi = changes.max_temperature !== undefined ? changes.max_temperature : device.max_temperature;
      if (lo != null && hi != null && lo >= hi) return msg('Min must be below max.', true);
      if (!Object.keys(changes).length) return msg('Nothing changed.', false);
      button.disabled = true;
      const updated = await account.api.updateDevice(account.token, id, changes);
      Object.assign(device, updated);
      if (source.kind === 'backend') { const d = source.devices.find(x => x.id === id); if (d) d.name = updated.name || id; }
      fillDevices();
      setMode();
      renderDevices();
      setStatus(`Saved ${updated.name || id}.`);
    } else if (button.dataset.act === 'unpair') {
      if (!button.classList.contains('confirm')) {
        button.classList.add('confirm');
        button.textContent = 'Confirm unpair';
        return msg('The device stops sending to your account. To use it again, pair it again from the device.', true);
      }
      button.disabled = true;
      await account.api.unpairDevice(account.token, id);
      await loadDevices();
      closePanel();
      await route();
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return signOut('Your session has expired. Please sign in again.');
    msg(err.message, true);
  } finally {
    button.disabled = false;
  }
});

// ------------------------------------------------------------------ 3D / 2D

document.querySelectorAll('#dim-select button').forEach(b => b.addEventListener('click', () => setDimension(b.dataset.v)));
$('plan-edit').addEventListener('click', () => {
  const on = !plan.editing;
  plan.setEditing(on);
  $('plan-edit').classList.toggle('on', on);
  $('plan-edit').textContent = on ? 'Done' : 'Move sensors';
  $('plan-reset').hidden = !on;
});
$('plan-reset').addEventListener('click', () => {
  for (const n of SENSOR_NAMES) { SENSORS[n].pos = [...DEFAULT_POSITIONS[n]]; scene.moveSensor(n); }
  store.set('sensor-positions', 'null');
  plan.refreshMarkers();
});

function setDimension(dim) {
  const twoD = dim === '2d';
  document.querySelectorAll('#dim-select button').forEach(x => x.classList.toggle('active', x.dataset.v === dim));
  if (twoD === plan.visible) return;
  document.body.classList.toggle('plan-mode', twoD);
  const el = $('plan');
  if (twoD) {
    el.hidden = false;
    plan.update({ sources: scene.sources, temps: smooth, target }, true);
    gsap.fromTo(el.querySelector('.plan-card'), { opacity: 0, scale: 0.96, y: 16 }, { opacity: 1, scale: 1, y: 0, duration: 0.7, ease: 'power3.out' });
  } else {
    if (plan.editing) $('plan-edit').click();
    gsap.to(el.querySelector('.plan-card'), { opacity: 0, scale: 0.97, duration: 0.35, ease: 'power2.in', onComplete: () => { el.hidden = true; } });
  }
}

// ------------------------------------------------------------------ data source helpers

function usePreview() {
  if (source.kind === 'preview') return;
  source = new PreviewSource();
  resetView();
  fillDevices();
  fillScenarios();
  setMode();
}

function resetView() {
  trace.length = 0;
  shownIssues = new Set();
  for (const n of SENSOR_NAMES) smooth[n] = null;
  targetTouched = false;
}

function setMode() {
  const chip = $('mode-chip');
  const mode = source.kind === 'preview' ? 'preview' : (state?.mode === 'demo' ? 'demo' : 'live');
  chip.textContent = { preview: 'Offline demo', demo: 'Demo room', live: 'Live' }[mode];
  chip.className = `chip ${mode}`;
  $('device-name').textContent = source.kind === 'preview' ? (account ? account.email : 'offline room') : (source.deviceName() || 'no device');
}

function setStatus(text) { $('connect-status').textContent = text; }
