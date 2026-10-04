import { auth, ApiError, streamLive } from './auth';
import { useEffect, useRef, useState } from 'react';
import { colors, defaults, initial, interpolate, keys, packetFromLive, temperatureColor, type Layout, type Packet, type Sensor } from './model';

const UPDATE_INTERVAL_MS = 1000;
const RECONNECT_MS = 3000;
const STALE_AFTER_SECONDS = 5;
const HISTORY_LIMIT = 2000;
const validPassword = (password: string) => password.length >= 8 && password.length <= 32 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    pulse: <path d="M2 12h5l3-8 4 16 3-8h5"/>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></>,
    bell: <><path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4zM10 21h4"/></>,
    temp: <><path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z"/><path d="M12 8v10"/></>,
    arrow: <path d="M5 16 16 5M6 5h10v10"/>,
    check: <path d="m5 12 4 4 10-10"/>,
    room: <><path d="M3 10 12 3l9 7v11H3zM9 21v-8h6v8"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    play: <path d="m8 5 11 7-11 7Z"/>,
    reset: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.grid}</svg>;
}
function Login({ onLogin, initialNotice }: { initialNotice: string; onLogin: (email: string, token: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(initialNotice);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    if (!validPassword(password)) { setError('Password must be 8–32 characters and include at least one letter and one number.'); return; }
    if (mode === 'register' && password !== confirmPassword) { setError('The passwords do not match.'); return; }
    setError(''); setNotice(''); setPending(true);
    try {
      const address = email.trim().toLowerCase();
      if (mode === 'register') {
        await auth.register(address, password);
        setEmail(address); setPassword(''); setConfirmPassword(''); setMode('login');
        setNotice('Account created. Sign in with your email and password.');
      } else {
        const token = await auth.token(address, password);
        const user = await auth.currentUser(token);
        onLogin(user.email, token);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete the account request.'); }
    finally { setPending(false); }
  }
  return <main className="login-page"><div className="login-card">
    <a className="brand login-brand" href="#" onClick={e => e.preventDefault()}><span className="brand-mark"><Icon name="room" size={24}/></span><span>Room<span className="brand-light">Sentinel</span><small>THERMAL GUARD</small></span></a>
    <div className="login-heading"><span className="login-eyebrow">YOUR ROOM, AT A GLANCE</span><h1>{mode === 'login' ? 'Welcome' : 'Create your account'}</h1><p>{mode === 'login' ? 'Sign in to continue to your room dashboard.' : 'Create an account to explore your room dashboard.'}</p></div>
    <form onSubmit={submit} noValidate>
      <label className="login-label" htmlFor="login-email">Email address</label>
      <div className="login-input-wrap"><Icon name="mail" size={17}/><input id="login-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} required/></div>
      <label className="login-label" htmlFor="login-password">Password</label>
      <div className="login-input-wrap"><Icon name="lock" size={17}/><input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="8–32 characters, with a letter and number" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} required minLength={8} maxLength={32} pattern="(?=.*[A-Za-z])(?=.*[0-9]).{8,32}"/><button type="button" className="password-toggle" onClick={() => setShowPassword(s => !s)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></div>
      {mode === 'register' && <><label className="login-label" htmlFor="login-confirm-password">Confirm password</label><div className="login-input-wrap"><Icon name="lock" size={17}/><input id="login-confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Enter your password again" value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setError(''); }} required maxLength={32}/></div></>}
      {notice && <p className="login-notice" role="status">{notice}</p>}
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="login-submit" type="submit" disabled={pending}>{pending ? 'Connecting…' : mode === 'login' ? 'Sign in' : 'Create account'} <span>→</span></button>
    </form>
    <div className="login-switch">{mode === 'login' ? 'New to Room Sentinel?' : 'Already have an account?'} <button type="button" disabled={pending} onClick={() => { setNotice(''); setPassword(''); setConfirmPassword(''); setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></div>
    <div className="login-demo"><strong>Room Sentinel account</strong><span>Your account is managed by our server. Passwords must contain 8–32 characters, including a letter and a number.</span></div>
    <div className="login-footer"><span className="status-dot"/>Secure room monitoring <span>·</span> Room Sentinel</div>
  </div></main>;
}
function AccountSettings({ email, onChangePassword, onDelete }: { email: string; onChangePassword: (oldPassword: string, newPassword: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (pending || deleting) return; setError(''); setMessage('');
    if (!oldPassword) { setError('Enter your current password.'); return; }
    if (!validPassword(newPassword)) { setError('New password must be 8–32 characters and include a letter and a number.'); return; }
    if (newPassword !== confirmation) { setError('The new passwords do not match.'); return; }
    if (oldPassword === newPassword) { setError('Choose a different password from your current password.'); return; }
    setPending(true);
    try { await onChangePassword(oldPassword, newPassword); setOldPassword(''); setNewPassword(''); setConfirmation(''); setMessage('Password updated successfully.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update the password.'); }
    finally { setPending(false); }
  }
  return <div className="account-settings">
    <section className="panel"><div className="panel-title"><h2>Account details</h2><span className="badge">CONNECTED</span></div><dl className="account-details"><div><dt>Email address</dt><dd>{email}</dd></div><div><dt>Account status</dt><dd>Signed in</dd></div><div><dt>Password requirements</dt><dd>8–32 characters, including a letter and a number</dd></div></dl><p className="help">Your email is retrieved from your server account.</p></section>
    <section className="panel"><div className="panel-title"><h2>Change password</h2><Icon name="lock" size={18}/></div><form className="account-password-form" onSubmit={submit} noValidate>
      <label className="field">Current password<input type="password" autoComplete="current-password" value={oldPassword} maxLength={32} required onChange={e => setOldPassword(e.target.value)}/></label>
      <label className="field">New password<input type="password" autoComplete="new-password" value={newPassword} minLength={8} maxLength={32} required onChange={e => setNewPassword(e.target.value)}/></label>
      <label className="field">Confirm new password<input type="password" autoComplete="new-password" value={confirmation} minLength={8} maxLength={32} required onChange={e => setConfirmation(e.target.value)}/></label>
      {error && <p className="login-error" role="alert">{error}</p>}{message && <p className="login-notice" role="status">{message}</p>}
      <button className="outline-button account-save" type="submit" disabled={pending || deleting}>{pending ? 'Updating…' : 'Change password'}</button>
    </form></section>
    <section className="panel account-delete"><div className="panel-title"><h2>Delete account</h2></div><p className="help">Permanently delete your account. You will be signed out after the server confirms deletion.</p>{confirmDelete ? <div className="delete-confirmation"><p>Permanently delete your account? This cannot be undone.</p><div className="account-actions"><button className="outline-button delete-button" disabled={deleting || pending} onClick={async () => { setDeleteError(''); setDeleting(true); try { await onDelete(); } catch (e) { setDeleteError(e instanceof Error ? e.message : 'Could not delete account.'); } finally { setDeleting(false); } }}>{deleting ? 'Deleting…' : 'Confirm deletion'}</button><button className="outline-button" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</button></div></div> : <button className="outline-button delete-button" disabled={pending} onClick={() => setConfirmDelete(true)}>Delete account</button>}{deleteError && <p className="login-error" role="alert">{deleteError}</p>}</section>
  </div>;
}
type Config = { name: string; width: number; length: number; target: number; layout: Layout };
const base: Config = { name: 'Living room', width: 6, length: 4, target: 21, layout: defaults };
function savedConfig(): Config {
  try { const c = JSON.parse(localStorage.getItem('sentinel-room') || 'null'); if (c && typeof c.name === 'string' && c.width >= 2 && c.width <= 12 && c.length >= 2 && c.length <= 12 && c.target >= 16 && c.target <= 28 && keys.every(k => c.layout?.[k]?.x >= .05 && c.layout[k].x <= .95 && c.layout[k].y >= .05 && c.layout[k].y <= .95)) return c; } catch { /* Use defaults when storage is unavailable. */ }
  return base;
}
function seedHistory(): Packet[] {
  const now = Date.now();
  return Array.from({ length: 1801 }, (_, i) => ({ ...Object.fromEntries(keys.map((k, j) => [k, initial[k] + Math.sin(i / 330 + j) * .35 + (1800 - i) * .0003])), timestamp: new Date(now - (1800 - i) * UPDATE_INTERVAL_MS).toISOString() } as Packet));
}
function Heatmap({ config, packet, visible }: { config: Config; packet: Packet; visible: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return;
    canvas.width = 320; canvas.height = Math.round(320 * config.length / config.width);
    const pixels = ctx.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const rgb = temperatureColor(interpolate(x / (canvas.width - 1), y / (canvas.height - 1), config.layout, packet, config.width, config.length));
      const p = (y * canvas.width + x) * 4; pixels.data.set([...rgb, 255], p);
    }
    ctx.putImageData(pixels, 0, 0);
  }, [config, packet]);
  return <canvas ref={ref} className="heatmap" style={{ opacity: visible ? .85 : 0 }} aria-label="Estimated temperature field interpolated from five sensors"/>;
}
function History({ history, minutes }: { history: Packet[]; minutes: number }) {
  const end = Date.parse(history.at(-1)!.timestamp), start = end - minutes * 60000;
  const data = history.filter(p => Date.parse(p.timestamp) >= start);
  const lo = Math.floor(Math.min(...data.flatMap(p => keys.map(k => p[k]))) - 2), hi = Math.ceil(Math.max(...data.flatMap(p => keys.map(k => p[k]))) + 2);
  const y = (v: number) => 155 - (v - lo) / (hi - lo) * 130;
  return <svg className="chart" viewBox="0 0 800 190" role="img" aria-label={`Temperature history of all five sensors over ${minutes} minutes`}>
    {[0, 1, 2, 3].map(i => { const v = lo + (hi - lo) * i / 3; return <g key={i}><line x1="42" y1={y(v)} x2="785" y2={y(v)} stroke="#e8ece8" strokeDasharray="3 5"/><text x="0" y={y(v) + 4}>{v.toFixed(0)}°</text></g>; })}
    {keys.map(k => <polyline key={k} fill="none" stroke={colors[k]} strokeWidth={k === 'Centre' ? 2.8 : 1.8} points={data.map(p => `${42 + (Date.parse(p.timestamp) - start) / (minutes * 60000) * 743},${y(p[k])}`).join(' ')}/>)}
    {[0, 1, 2, 3, 4].map(i => <text key={i} x={42 + i * 185} y="184" textAnchor={i === 4 ? 'end' : 'start'}>{i === 4 ? 'Now' : `${minutes - minutes * i / 4} min ago`}</text>)}
  </svg>;
}
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accountEmail, setAccountEmail] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [config, setConfig] = useState(savedConfig);
  const [history, setHistory] = useState<Packet[]>(seedHistory);
  const [packet, setPacket] = useState<Packet>(() => ({ ...initial, timestamp: new Date().toISOString() }));
  const [page, setPage] = useState('Overview');
  const [jumpToSensors, setJumpToSensors] = useState(false);
  const readingsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (page !== 'Overview' || !jumpToSensors || !readingsRef.current) return;
    readingsRef.current.focus({ preventScroll: true });
    readingsRef.current.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    setJumpToSensors(false);
  }, [page, jumpToSensors]);
  const [editing, setEditing] = useState(false), [selected, setSelected] = useState<Sensor>('Centre');
  const [gradient, setGradient] = useState(true), [paused, setPaused] = useState(false), [minutes, setMinutes] = useState(30);
  const [source, setSource] = useState<'demo' | 'live'>('demo');
  // Rooms in the live stream (device id -> mode), the one shown, and display names from GET /devices.
  const [liveRooms, setLiveRooms] = useState<Record<string, string>>({}), [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});
  const chosenDevice = useRef<string | null>(null);
  const [error, setError] = useState(''), [connected, setConnected] = useState(false), [clock, setClock] = useState(Date.now());
  const mapRef = useRef<HTMLDivElement>(null), dragging = useRef<Sensor | null>(null);
  const demoBase = useRef<Record<Sensor, number>>({ ...initial });
  useEffect(() => { try { localStorage.setItem('sentinel-room', JSON.stringify(config)); } catch { /* Layout remains usable in memory. */ } }, [config]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (paused || !isAuthenticated) return;
    let disposed = false; const controller = new AbortController();
    function accept(p: Packet) { if (disposed) return; setPacket(p); setHistory(h => { const stamp = Date.parse(p.timestamp); const without = h.filter(item => Date.parse(item.timestamp) !== stamp); return [...without, p].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-HISTORY_LIMIT); }); }
    if (source === 'demo') {
      const tick = () => { const t = Date.now() / 10000; accept({ ...Object.fromEntries(keys.map((k, i) => [k, Math.round((demoBase.current[k] + Math.sin(t + i) * .12) * 10) / 10])), timestamp: new Date().toISOString() } as Packet); };
      tick(); const timer = setInterval(tick, UPDATE_INTERVAL_MS);
      return () => { disposed = true; clearInterval(timer); };
    }
    // Frames repeat the same reading while nothing changes; only a new reading time is a new point.
    let lastTime = '', lastDevice = '', current = packet;
    auth.devices(accessToken).then(list => { if (!disposed) setDeviceNames(Object.fromEntries(list.map(d => [d.device_id, d.name || d.device_id]))); }).catch(() => { /* Serials stand in for names. */ });
    async function follow() {
      while (!disposed) {
        try {
          await streamLive(accessToken, controller.signal, frame => {
            if (disposed) return;
            setConnected(true); setError('');
            const rooms = Object.fromEntries(Object.entries(frame.latest).map(([id, r]) => [id, r.mode]));
            setLiveRooms(prev => JSON.stringify(prev) === JSON.stringify(rooms) ? prev : rooms);
            const next = packetFromLive(frame.latest, current, chosenDevice.current);
            if (!next) { setError('No device is sending readings yet.'); return; }
            if (next.deviceId !== lastDevice) { lastDevice = next.deviceId; lastTime = ''; setDeviceId(next.deviceId); }
            if (next.time === lastTime) return;
            lastTime = next.time; current = next.packet; accept(next.packet);
          });
          if (!disposed) throw new Error('The live stream closed.');
        } catch (e) {
          if (disposed) return;
          setConnected(false); setError(e instanceof Error ? e.message : 'Could not reach the API.');
          if (e instanceof ApiError && e.status === 401) return;
          await new Promise(resolve => setTimeout(resolve, RECONNECT_MS));
        }
      }
    }
    void follow();
    return () => { disposed = true; controller.abort(); };
  }, [source, paused, isAuthenticated, accessToken]);
  const age = Math.max(0, (clock - Date.parse(packet.timestamp)) / 1000);
  const stale = age > STALE_AFTER_SECONDS;
  const ambient = (packet.Centre + packet.Door + packet['Far wall']) / 3;
  const gap = packet.Centre - packet.Window;
  const reference = history.find(p => Date.parse(p.timestamp) >= Date.parse(packet.timestamp) - 600000);
  const elapsed = reference ? (Date.parse(packet.timestamp) - Date.parse(reference.timestamp)) / 60000 : 0;
  const slope = elapsed >= 1 ? (packet.Centre - reference!.Centre) / elapsed : 0;
  const forecast = packet.Centre + slope * 20;
  const warning = gap > 3;
  const updateConfig = (patch: Partial<Config>) => setConfig(c => ({ ...c, ...patch }));
  function moveSensor(clientX: number, clientY: number, key: Sensor) {
    const rect = mapRef.current!.getBoundingClientRect();
    setConfig(c => ({ ...c, layout: { ...c.layout, [key]: { x: Math.max(.05, Math.min(.95, (clientX - rect.left) / rect.width)), y: Math.max(.05, Math.min(.95, (clientY - rect.top) / rect.height)) } } }));
  }
  function changeTemperature(key: Sensor, value: number) {
    demoBase.current[key] = value; const p = { ...packet, [key]: value, timestamp: new Date().toISOString() }; setPacket(p); setHistory(h => [...h, p].slice(-HISTORY_LIMIT));
  }
  // The stream keeps running; the next frame shows the chosen room. Its history starts over so rooms never mix.
  function changeDevice(id: string) { chosenDevice.current = id; setDeviceId(id); setHistory([{ ...packet }]); }
  function changeSource(value: 'demo' | 'live') { setSource(value); setConnected(false); setError(''); setHistory([{ ...packet }]); }
  function navigatePage(nextPage: string) { setPage(nextPage); window.scrollTo(0, 0); }
  function signOut() { setAccountEmail(''); setAccessToken(''); setIsAuthenticated(false); setPage('Overview'); setJumpToSensors(false); window.scrollTo(0, 0); }
  function sessionError(e: unknown) {
    if (e instanceof ApiError && e.status === 401) { signOut(); setAuthNotice('Your session has expired. Please sign in again.'); }
    throw e;
  }
  async function changeAccountPassword(oldPassword: string, newPassword: string) {
    let verifiedToken: string;
    try { verifiedToken = await auth.token(accountEmail, oldPassword); }
    catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 400)) throw new Error('The current password is incorrect.'); throw e; }
    try { await auth.changePassword(verifiedToken, newPassword); }
    catch (e) { sessionError(e); }
    signOut(); setAuthNotice('Password updated. Please sign in with your new password.');
  }
  async function deleteAccount() {
    try { await auth.deleteAccount(accessToken); signOut(); setAuthNotice('Your account has been deleted.'); }
    catch (e) { sessionError(e); }
  }
  if (!isAuthenticated) return <Login key={authNotice} initialNotice={authNotice} onLogin={(email, token) => { setAccountEmail(email); setAccessToken(token); setAuthNotice(''); setIsAuthenticated(true); navigatePage('Overview'); }}/ >;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigatePage('Overview'); }}><span className="brand-mark"><Icon name="room" size={24}/></span><span>Room<span className="brand-light">Sentinel</span><small>THERMAL GUARD</small></span></a>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav>{[['Overview', 'grid'], ['Sensor readings', 'pulse'], ['Insights', 'bell'], ['Settings', 'settings'], ['Account settings', 'lock']].map(([title, icon]) => <button key={title} className={page === title ? 'nav-item active' : 'nav-item'} onClick={() => { if (title === 'Sensor readings') { setPage('Overview'); setJumpToSensors(true); } else { navigatePage(title); } }}><Icon name={icon}/>{title}{title === 'Insights' && warning && <span className="nav-count">1</span>}</button>)}</nav>
      <div className="sidebar-room"><span className="tiny-label">CONNECTED ROOM</span><strong><span className="status-dot"/>{config.name}</strong><small>5 temperature sensors</small></div>
      <div className="sidebar-bottom"><span className="avatar">{(accountEmail.slice(0, 2) || 'RS').toUpperCase()}</span><div><button className="account-link" onClick={() => navigatePage('Account settings')}>Account</button><small title={accountEmail}>{accountEmail || 'Prototype workspace'}</small></div><button className="logout-button" onClick={signOut} aria-label="Sign out" title="Sign out">Sign out</button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div>{page}</div><div className="topbar-right"><span className="source-tag"><span className={`status-dot ${source === 'live' && !connected ? 'muted' : ''}`}/>{source === 'demo' ? 'Demo mode' : connected ? 'Live' : 'Offline'}</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">{source === 'demo' ? 'updates: 1s interval' : 'updates: live stream'}</div><h1>{page === 'Overview' ? config.name : page}</h1></div>{page !== 'Account settings' && <button className="outline-button" onClick={() => { navigatePage('Overview'); setEditing(!editing); }}><Icon name="settings" size={17}/>{editing ? 'Finish editing' : 'Customize room'}</button>}</div>
        {(error || stale) && <div className="connection-warning" role="status">{error ? `API unavailable: ${error} Last received values are shown.` : `Readings are ${Math.floor(age)} seconds old.`}</div>}
        {page === 'Account settings' ? <AccountSettings email={accountEmail} onChangePassword={changeAccountPassword} onDelete={deleteAccount}/> : page === 'Settings' ? <section className="panel settings-panel"><div className="panel-title"><h2>Data connection</h2><span className="subtle">Live stream</span></div><p className="subtle">Show the demo simulation, or stream readings from the devices on your account.</p><label className="field">Data source<select value={source} onChange={e => changeSource(e.target.value as 'demo' | 'live')}><option value="demo">Demo simulation</option><option value="live">My devices</option></select></label>{source === 'live' && Object.keys(liveRooms).length > 0 && <label className="field">Device<select value={deviceId ?? ''} onChange={e => changeDevice(e.target.value)}>{Object.entries(liveRooms).map(([id, mode]) => <option key={id} value={id}>{deviceNames[id] ?? id}{mode === 'demo' ? ' (simulated)' : ''}</option>)}</select></label>}<p className="help">Readings arrive as they are measured. Measurements older than 5 seconds are marked stale.</p></section> : <>
        <div className="metrics-row">
          <div className="metric-card"><span className="metric-title">Room centre <Icon name="temp" size={17}/></span><strong>{packet.Centre.toFixed(1)}<span>°C</span></strong><small className={Math.abs(packet.Centre - config.target) <= 2 ? 'positive' : 'amber'}>{packet.Centre < config.target - 2 ? 'Below comfort range' : packet.Centre > config.target + 2 ? 'Above comfort range' : 'Within comfort range'} <span className="subtle">· Target {config.target}°</span></small></div>
          <div className="metric-card"><span className="metric-title">Temperature spread <Icon name="pulse" size={17}/></span><strong>{(Math.max(...keys.map(k => packet[k])) - Math.min(...keys.map(k => packet[k]))).toFixed(1)}<span>°C</span></strong><small className="subtle">Warmest to coolest sensor</small></div>
          <div className="metric-card"><span className="metric-title">20-minute outlook <Icon name="arrow" size={17}/></span><strong>{forecast.toFixed(1)}<span>°C</span></strong><small className="subtle">{slope < -.01 ? '↓ Cooling' : slope > .01 ? '↑ Warming' : '→ Mostly steady'} · Basic trend estimate</small></div>
          <div className="metric-card"><span className="metric-title">Sensor health <Icon name="check" size={17}/></span><strong>{stale ? '—' : '5'}<span>/ 5</span></strong><small className={stale ? 'amber' : 'positive'}><span className={`status-dot ${stale ? 'muted' : ''}`}/>{stale ? 'Waiting for fresh readings' : 'All sensors reporting'}</small></div>
        </div>
        {page === 'Overview' && <div className="overview-grid"><section className="panel room-panel"><div className="panel-title"><div><h2>Room Thermal Field <span className="badge">TOP VIEW</span></h2><p>{config.name} <span className="separator">·</span> {config.width} × {config.length} m <span className="separator">·</span> {(config.width * config.length).toFixed(1)} m²</p></div></div>
          <div className="room-stage"><div className="dimension width-dimension">{config.width.toFixed(1)} m</div><div className="floor" ref={mapRef} style={{ aspectRatio: `${config.width}/${config.length}` }} onPointerMove={e => { if (dragging.current) moveSensor(e.clientX, e.clientY, dragging.current); }} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}>
            <Heatmap config={config} packet={packet} visible={gradient}/><div className="floor-grid"/><div className="window-fixture"/><div className="heater-fixture">{Array.from({ length: 6 }, (_, i) => <i key={i}/>)}</div><div className="door-fixture"/><div className="room-name">{config.name}<small>{(config.width * config.length).toFixed(1)} m²</small></div>
            {keys.map(k => <button key={k} className={`sensor-marker ${selected === k ? 'selected' : ''} ${editing ? 'draggable' : ''}`} style={{ left: `${config.layout[k].x * 100}%`, top: `${config.layout[k].y * 100}%`, '--sensor-color': colors[k] } as React.CSSProperties} onClick={() => setSelected(k)} onPointerDown={e => { setSelected(k); if (editing) { e.preventDefault(); dragging.current = k; mapRef.current!.setPointerCapture(e.pointerId); } }} onKeyDown={e => { if (!editing || !e.key.startsWith('Arrow')) return; e.preventDefault(); const p = config.layout[k]; updateConfig({ layout: { ...config.layout, [k]: { x: Math.max(.05, Math.min(.95, p.x + (e.key === 'ArrowRight' ? .02 : e.key === 'ArrowLeft' ? -.02 : 0))), y: Math.max(.05, Math.min(.95, p.y + (e.key === 'ArrowDown' ? .02 : e.key === 'ArrowUp' ? -.02 : 0))) } } }); }} aria-label={`${k}: ${packet[k]} degrees Celsius${editing ? '. Drag or use arrow keys to reposition.' : ''}`}><span className="sensor-dot"/><span className="sensor-label"><span className="sensor-id">S-0{keys.indexOf(k) + 1}</span>{k === 'Centre' ? 'Room centre' : k}<strong>{packet[k].toFixed(1)}°<span>C</span></strong></span></button>)}
          </div><div className="dimension length-dimension">{config.length.toFixed(1)} m</div></div>
          <div className="map-footer"><label className="toggle-label"><input type="checkbox" checked={gradient} onChange={e => setGradient(e.target.checked)}/><span className="toggle"/>Temperature overlay</label><div className="color-legend"><span>15°</span><i/><span>35°</span></div></div><p className="map-note">{editing ? 'Drag a sensor to reposition it. Layout saves automatically.' : 'An estimated temperature field from five point readings. Select a sensor to explore.'}</p>
        </section><aside className="right-column">
          {editing ? <section className="panel editor-panel"><div className="panel-title"><h2>Make it your room</h2><span className="badge">EDITING</span></div><label className="field">Room name<input value={config.name} maxLength={30} onChange={e => updateConfig({ name: e.target.value })}/></label><div className="two-fields"><label className="field">Width (m)<input type="number" min="2" max="12" step=".5" value={config.width} onChange={e => { const n = Number(e.target.value); if (n >= 2 && n <= 12) updateConfig({ width: n }); }}/></label><label className="field">Length (m)<input type="number" min="2" max="12" step=".5" value={config.length} onChange={e => { const n = Number(e.target.value); if (n >= 2 && n <= 12) updateConfig({ length: n }); }}/></label></div><label className="field">Comfort target · {config.target}°C<input type="range" min="16" max="28" step=".5" value={config.target} onChange={e => updateConfig({ target: Number(e.target.value) })}/></label><button className="outline-button full" onClick={() => updateConfig({ layout: defaults })}><Icon name="reset" size={16}/>Reset sensor positions</button></section> : <section className="panel comfort-panel"><div className="panel-title"><h2>General</h2></div><div className="comfort-gauge"><Icon name="room" size={27}/><strong>{ambient.toFixed(1)}<span>°C</span></strong><small title="The arithmetic mean of Centre, Door, and Far wall. Window and Heater readings are excluded because they measure local cold and hot spots.">Ambient sensor average</small><small>Centre · Door · Far wall</small></div><div className="comfort-summary"><span className="status-dot"/>{Math.abs(ambient - config.target) <= 2 ? 'Your room feels comfortable' : ambient < config.target ? 'Room is below your target' : 'Room is above your target'}</div><div className="condition-row"><span>Comfort target</span><strong>{config.target.toFixed(1)}°C</strong></div><div className="condition-row"><span>Window difference</span><strong className={warning ? 'amber' : ''}>{Math.abs(gap).toFixed(1)}°C {gap >= 0 ? 'cooler' : 'warmer'}</strong></div></section>}
          <section className="insight-card"><span className="insight-kicker"><Icon name="pulse" size={17}/>ROOM INSIGHT</span><h3>{warning ? 'A cooler spot by the window' : 'A balanced room'}</h3><p>{warning ? `The window sensor is ${gap.toFixed(1)}°C cooler than the centre. This may indicate heat loss around the window.` : 'The centre and window readings are close. Keep an eye on how they change over time.'}</p><button onClick={() => navigatePage('Insights')}>Explore insights <span>↗</span></button></section>
        </aside></div>}
        {page === 'Insights' && <section className="panel insights-page"><div className="panel-title"><h2>Thermal observations</h2><span className="badge">RULE BASED</span></div><h3>{warning ? 'Possible heat loss near the window' : 'Window temperature is close to the centre'}</h3><p>The centre is {packet.Centre.toFixed(1)}°C and the window is {packet.Window.toFixed(1)}°C. {warning ? 'Check the window seal and whether the window is open.' : 'No large window temperature difference is currently detected.'}</p><h3>Temperature outlook</h3><p>The centre trend is {(slope * 10).toFixed(2)}°C per 10 minutes. If that trend continues, the centre may reach {forecast.toFixed(1)}°C in 20 minutes.</p><p className="help">These observations use simple temperature comparisons and a linear trend. They are approximate and do not establish the cause of a change.</p></section>}
        {page !== 'Insights' && <section className="panel history-panel"><div className="panel-title"><div><h2>Thermal Telemetry History</h2><p>Continuous temperature readings across room zones.</p></div><div className="segmented">{[5, 15, 30].map(n => <button key={n} className={minutes === n ? 'chosen' : ''} onClick={() => setMinutes(n)}>{n} min</button>)}</div></div><div className="chart-legend">{keys.map(k => <span key={k}><i style={{ background: colors[k] }}/>{k === 'Centre' ? 'Room centre' : k}</span>)}</div><History history={history} minutes={minutes}/></section>}
        <section className="sensor-section" id="sensor-readings" ref={readingsRef} tabIndex={-1} aria-label="Sensor readings"><div className="section-title"><h2>Sensor readings <span className="subtle">/ 05</span></h2><span className="subtle">{source === 'demo' ? 'Simulated measurements' : deviceId ? `Live readings · ${deviceNames[deviceId] ?? deviceId}` : 'Live device readings'}</span></div><div className="sensor-cards">{keys.map((k, i) => <button key={k} className={`sensor-card ${selected === k ? 'focused' : ''}`} onClick={() => setSelected(k)}><div className="sensor-card-top"><span className="sensor-number">0{i + 1}</span><span className={`status-dot ${stale ? 'muted' : ''}`}/></div><span>{k === 'Centre' ? 'Room centre' : k}</span><strong>{packet[k].toFixed(1)}<small>°C</small></strong><div className="sensor-card-bottom"><i style={{ background: colors[k] }}/>{stale ? 'Stale reading' : 'Reporting normally'}</div></button>)}</div></section>
        <section className="demo-strip"><div><strong>{selected === 'Centre' ? 'Room centre' : selected} sensor</strong><span>{source === 'demo' ? 'Adjust a demo reading to explore the temperature map.' : `Measured at ${new Date(packet.timestamp).toLocaleTimeString()}`}</span></div>{source === 'demo' && <><input aria-label={`${selected} demo temperature`} type="range" min="5" max="45" step=".1" value={packet[selected]} onChange={e => changeTemperature(selected, Number(e.target.value))}/><strong>{packet[selected].toFixed(1)}°C</strong></>}<button className="outline-button" onClick={() => setPaused(!paused)}><Icon name={paused ? 'play' : 'pause'} size={15}/>{paused ? 'Resume' : 'Pause'}</button></section>
        </>}
        <footer><span><span className={`status-dot ${stale ? 'muted' : ''}`}/>{paused ? 'Updates paused' : source === 'demo' ? 'Demo data · updates every second' : 'Live data · streamed as measured'}</span></footer>
      </main>
    </div>
  </div>;
}
