import { useEffect, useRef, useState } from 'react';
import { ApiError, request } from './auth';
import { parsePacket, type Packet } from './model';

export type Device = { device_id: string; name?: string | null; target_temperature?: number | null; min_temperature?: number | null; max_temperature?: number | null };
type Pairing = { device_id: string; expires_at: string };
export const deviceApi = {
  list: (token: string) => request<Device[]>('/devices', 'GET', undefined, token),
  update: (token: string, id: string, body: Partial<Device>) => request<Device>(`/devices/${encodeURIComponent(id)}`, 'PATCH', body, token),
  unpair: (token: string, id: string) => request<void>(`/devices/${encodeURIComponent(id)}`, 'DELETE', undefined, token),
  pairing: (token: string, code: string) => request<Pairing>(`/pairing/${encodeURIComponent(code)}`, 'GET', undefined, token),
  confirm: (token: string, code: string) => request<void>(`/pairing/${encodeURIComponent(code)}/confirm`, 'POST', undefined, token),
  latest: (token: string) => request<Record<string, unknown>>('/latest', 'GET', undefined, token),
};

// /latest returns the newest package keyed by device serial number.
export function devicePacket(latest: Record<string, unknown>, id: string): Packet | null {
  const entry = latest[id];
  if (entry == null) return null;
  if (typeof entry !== 'object') throw new Error('The device returned an invalid reading package.');
  const record = entry as Record<string, unknown>;
  const readings = record.readings ?? record.temperatures ?? record.temps ?? record;
  if (!readings || typeof readings !== 'object') throw new Error('The device returned an invalid reading package.');
  return parsePacket({ ...(readings as object), timestamp: record.timestamp ?? record.ts ?? (readings as Record<string, unknown>).timestamp });
}

export function useDevices(token: string, active: boolean, onExpired: () => void) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [demo, setDemo] = useState(false);
  const [revision, setRevision] = useState(0);
  const expired = useRef(onExpired); expired.current = onExpired;
  useEffect(() => {
    if (!active) { setDevices([]); setLoaded(false); setError(''); setSelectedId(''); setDemo(false); return; }
    let disposed = false, busy = false;
    async function check() {
      if (busy) return; busy = true;
      try {
        const list = await deviceApi.list(token);
        if (disposed) return;
        setDevices(list); setLoaded(true); setError('');
        setSelectedId(id => list.some(device => device.device_id === id) ? id : list[0]?.device_id || '');
        if (list.length) setDemo(false);
      } catch (e) {
        if (disposed) return;
        if (e instanceof ApiError && e.status === 401) expired.current();
        else setError(e instanceof Error ? e.message : 'Could not load devices.');
      } finally { busy = false; }
    }
    void check(); const timer = setInterval(() => void check(), 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [token, active, revision]);
  return { devices, loaded, error, demo, setDemo, selected: devices.find(device => device.device_id === selectedId), select: setSelectedId, refresh: () => setRevision(value => value + 1) };
}

export function AddDevice({ onDemo }: { onDemo: () => void }) {
  return <section className="panel pairing-start"><h2>Add your first device</h2><ol><li>Turn on your Room Sentinel device and connect it to the internet.</li><li>Choose pairing on the device and scan its QR code.</li><li>Sign in here, check the serial number, and confirm pairing.</li></ol><p className="help">This page checks automatically and opens your real room when a device is paired.</p><button className="outline-button" onClick={onDemo}>Explore the demo room</button></section>;
}

function pairingCode() {
  const match = window.location.hash.match(/^#pair\/([^/]+)$/);
  try { return match ? decodeURIComponent(match[1]) : ''; } catch { return ''; }
}
export function PairingPanel({ token, onPaired, onExpired }: { token: string; onPaired: () => void; onExpired: () => void }) {
  const [code, setCode] = useState(pairingCode);
  const [info, setInfo] = useState<Pairing | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const expiredCallback = useRef(onExpired); expiredCallback.current = onExpired;
  useEffect(() => { const update = () => setCode(pairingCode()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => {
    if (!code) return;
    let disposed = false; setInfo(null); setError(''); setLoading(true);
    void deviceApi.pairing(token, code).then(value => { if (!disposed) setInfo(value); }).catch(e => {
      if (disposed) return;
      if (e instanceof ApiError && e.status === 401) expiredCallback.current();
      else setError(`${e instanceof Error ? e.message : 'Could not check the pairing code.'} If this code has expired or was already used, start pairing again on the device and scan the new QR code.`);
    }).finally(() => { if (!disposed) setLoading(false); });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [code, token]);
  if (!code) return null;
  const expired = !!info && Date.parse(info.expires_at) <= now;
  return <section className="panel pairing-panel"><h2>Pair your device</h2>{loading && <p role="status">Checking pairing code…</p>}{info && <><p>Check that this serial number matches your device:</p><strong className="device-serial">{info.device_id}</strong>{expired ? <p className="login-error">This pairing code has expired. Start pairing again on your device and scan the new QR code.</p> : <button className="outline-button" disabled={pending} onClick={async () => {
    setPending(true); setError('');
    try { await deviceApi.confirm(token, code); window.history.replaceState(null, '', window.location.pathname + window.location.search); setCode(''); onPaired(); }
    catch (e) { if (e instanceof ApiError && e.status === 401) expiredCallback.current(); else setError(`${e instanceof Error ? e.message : 'Could not pair device.'} Start pairing again on the device if this code has expired or was already used.`); }
    finally { setPending(false); }
  }}>{pending ? 'Pairing…' : 'Confirm pairing'}</button>}</>}{error && <p className="login-error" role="alert">{error}</p>}<button className="outline-button" disabled={pending} onClick={() => { window.history.replaceState(null, '', window.location.pathname + window.location.search); setCode(''); }}>Dismiss</button></section>;
}

function DeviceCard({ device, token, onChange, onShow, onExpired }: { device: Device; token: string; onChange: () => void; onShow: () => void; onExpired: () => void }) {
  const [name, setName] = useState(device.name || device.device_id);
  const [min, setMin] = useState(String(device.min_temperature ?? 18));
  const [target, setTarget] = useState(String(device.target_temperature ?? 21));
  const [max, setMax] = useState(String(device.max_temperature ?? 26));
  const [pending, setPending] = useState(false), [confirm, setConfirm] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function action(callback: () => Promise<unknown>, message: string) {
    if (pending) return;
    setPending(true); setError(''); setNotice('');
    try { await callback(); setConfirm(false); setNotice(message); onChange(); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onExpired(); else setError(e instanceof Error ? e.message : 'Could not update device.'); }
    finally { setPending(false); }
  }
  return <section className="panel device-card"><div className="panel-title"><h2>{device.name || device.device_id}</h2><button className="outline-button" onClick={onShow}>Show room</button></div><p className="device-serial">Serial: {device.device_id}</p><form onSubmit={e => {
    e.preventDefault(); const values = [min, target, max].map(Number);
    if (!name.trim() || [min, target, max].some(value => !value.trim()) || values.some(value => !Number.isFinite(value) || value < -55 || value > 120) || values[0] > values[1] || values[1] > values[2]) { setError('Enter a name and temperatures between −55 and 120°C, with minimum ≤ target ≤ maximum.'); return; }
    void action(() => deviceApi.update(token, device.device_id, { name: name.trim(), min_temperature: values[0], target_temperature: values[1], max_temperature: values[2] }), 'Device settings saved.');
  }}><label className="field">Name<input value={name} maxLength={100} required onChange={e => setName(e.target.value)}/></label><div className="device-temperatures">{[['Minimum (°C)', min, setMin], ['Target (°C)', target, setTarget], ['Maximum (°C)', max, setMax]].map(([label, value, setter]) => <label className="field" key={label as string}>{label as string}<input type="number" min="-55" max="120" step="0.1" required value={value as string} onChange={e => (setter as (value: string) => void)(e.target.value)}/></label>)}</div><button className="outline-button" disabled={pending} type="submit">{pending ? 'Saving…' : 'Save settings'}</button></form>{error && <p className="login-error" role="alert">{error}</p>}{notice && <p className="login-notice" role="status">{notice}</p>}{confirm ? <div className="account-actions"><p>Unpair this device from your account?</p><button className="outline-button delete-button" disabled={pending} onClick={() => void action(() => deviceApi.unpair(token, device.device_id), 'Device unpaired.')}>Confirm unpair</button><button className="outline-button" disabled={pending} onClick={() => setConfirm(false)}>Cancel</button></div> : <button className="outline-button delete-button" disabled={pending} onClick={() => setConfirm(true)}>Unpair device</button>}</section>;
}

export function DevicesPanel({ devices, token, onChange, onShow, onExpired }: { devices: Device[]; token: string; onChange: () => void; onShow: (id: string) => void; onExpired: () => void }) {
  return <div className="devices-panel">{devices.map(device => <DeviceCard key={device.device_id} device={device} token={token} onChange={onChange} onShow={() => onShow(device.device_id)} onExpired={onExpired}/>)}</div>;
}
