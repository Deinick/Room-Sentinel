import { RoomScene } from './scene.js';
import { PreviewSource } from './preview.js';
import { BackendSource } from './backend.js';
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

const scene = new RoomScene($('scene'), { onSensorClick: name => { openPanel('sensors'); scene.flyToSensor(name); highlightSensor(name); } });

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
  // Links can start straight into a story, e.g. ?scenario=window_open&view=window&outside=-5
  const params = new URLSearchParams(location.search);
  if (params.has('outside')) source.setControls({ outside_c: Number(params.get('outside')) });
  if (params.has('window')) source.setControls({ window: params.get('window') });
  if (params.has('scenario')) source.startScenario(params.get('scenario'));
  if (params.has('panel')) setTimeout(() => openPanel(params.get('panel')), 1200);
  const view = params.get('view') || 'overview';
  scene.flyTo(view, 2.6);
  document.querySelectorAll('#view-row button').forEach(x => x.classList.toggle('active', x.dataset.view === view));
  gsap.from('[data-reveal]', { opacity: 0, y: 14, duration: 1.1, ease: 'power3.out', stagger: 0.09, delay: 0.5 });
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
  if (rate == null) { trend.textContent = 'Measuring…'; trend.className = 'trend'; }
  else if (Math.abs(rate) < 0.01) { trend.textContent = 'Stable'; trend.className = 'trend'; }
  else { trend.textContent = `${rate > 0 ? '↑ +' : '↓ '}${rate.toFixed(2)} °C/min`; trend.className = `trend ${rate > 0 ? 'up' : 'down'}`; }

  const issues = state.issues || [];
  const serious = issues.filter(i => i.severity !== 'INFO');
  const status = $('hud-status');
  if (!state.live) { status.textContent = 'Offline'; status.className = 'status warn'; }
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
      <div class="sensor-meta"><span><i class="dot ${ok ? '' : 'bad'}"></i>${ok ? 'Reporting' : s.status.replace('_', ' ')}</span><span>${SENSORS[name].note}</span></div>
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
  $('chart-legend').innerHTML = names.map(n => `<span><i style="background:${SENSOR_COLORS[n]}"></i>${SENSORS[n].label}</span>`).join('');
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
  $('rate-legend').innerHTML = '<span><i style="background:#e8eef6"></i>Measured (°C/min)</span>' +
    (expected.length ? '<span><i style="background:#7cc4ff"></i>Expected for this room</span>' : '<span class="muted">Expected rate comes from the backend detector</span>');
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

// ------------------------------------------------------------------ connection

document.querySelectorAll('#source-select button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#source-select button').forEach(x => x.classList.toggle('active', x === b));
  const backend = b.dataset.source === 'backend';
  $('backend-form').hidden = !backend;
  if (!backend) usePreview();
}));
$('api-url').value = store.get('api-url') || $('api-url').value;
$('api-email').value = store.get('api-email') || '';

$('connect-btn').addEventListener('click', async () => {
  const btn = $('connect-btn');
  btn.disabled = true;
  setStatus('Signing in…');
  try {
    const backend = new BackendSource($('api-url').value);
    await backend.login($('api-email').value, $('api-password').value);
    store.set('api-url', $('api-url').value);
    store.set('api-email', $('api-email').value);
    source = backend;
    state = source.state();
    resetView();
    fillDevices();
    fillScenarios();
    setMode();
    setStatus(source.devices.length ? `Connected · ${source.devices.length} device(s).` : 'Connected, but no device is sending data yet.');
  } catch (e) {
    setStatus(`Could not connect: ${e.message}. Is the API running, and does it allow this page (CORS)?`);
  } finally {
    btn.disabled = false;
  }
});

function fillDevices() {
  const select = $('device-select');
  $('device-field').hidden = !source.devices?.length;
  select.innerHTML = (source.devices || []).map(d => `<option value="${d.id}" ${d.id === source.deviceId ? 'selected' : ''}>${d.id}${d.mode === 'demo' ? ' · simulated' : ''}</option>`).join('');
}
$('device-select').addEventListener('change', async e => {
  source.deviceId = e.target.value;
  resetView();
  await poll();
  setMode();
});

function usePreview() {
  if (source.kind === 'preview') return;
  source = new PreviewSource();
  resetView();
  fillScenarios();
  setMode();
  setStatus('Offline preview: a small built-in room simulation so this page works without the backend. Its alerts are simple rules, not the real detector.');
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
  chip.textContent = { preview: 'Preview', demo: 'Simulated', live: 'Live' }[mode];
  chip.className = `chip ${mode}`;
  $('device-name').textContent = source.kind === 'preview' ? 'offline room' : (source.deviceId || 'no device');
}

function setStatus(text) { $('connect-status').textContent = text; }
