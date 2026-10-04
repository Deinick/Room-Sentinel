// Room Sentinel API, the same calls the website uses (frontend/room-view/js/account.js, backend.js).
// Accounts:  POST /users, POST /token, GET/PUT/DELETE /users/me
// Devices:   GET /devices, PATCH/DELETE /devices/{id}, GET /pairing/{code}, POST /pairing/{code}/confirm
// Room data: GET /latest, GET /issues

export const DEFAULT_API = 'https://stormhacks.onrender.com';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export type User = { id: number; email: string };

export type Device = {
  device_id: string;
  name: string | null;
  target_temperature: number | null;
  min_temperature: number | null;
  max_temperature: number | null;
};

export type SensorReading = { temp: number | null; status: string };

export type Latest = {
  time: string;
  mode: 'device' | 'demo';
  age_seconds: number;
  live: boolean;
  sensors: Record<string, SensorReading>;
};

export type Issue = {
  device_id: string;
  kind: string;
  sensor: string | null;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  evidence: Record<string, unknown>;
  recommendations: string[];
  opened_at: string;
};

export type PairingInfo = { device_id: string; expires_at: string };

export const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
// Same rule as the backend: 8-32 characters with at least one letter and one number.
export const validPassword = (p: string) => p.length >= 8 && p.length <= 32 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);
export const PASSWORD_RULE = '8–32 characters, with at least one letter and one number.';

/** The pairing code inside the device's QR code: …/room-view/#pair/CODE, …?pair=CODE, or just the code. */
export function pairingCode(scanned: string): string | null {
  const text = scanned.trim();
  const match = text.match(/#pair\/([A-Za-z0-9_-]{6,})/) || text.match(/[?&]pair=([A-Za-z0-9_-]{6,})/) || text.match(/\/pair\/([A-Za-z0-9_-]{6,})/);
  if (match) return match[1];
  return /^[A-Za-z0-9_-]{6,64}$/.test(text) ? text : null;
}

export function createApi(baseUrl: string, getToken: () => string | null) {
  const base = baseUrl.replace(/\/+$/, '');

  async function request<T>(path: string, method = 'GET', body?: unknown, token = getToken()): Promise<T> {
    let response: Response;
    // the deployed server can take a while to wake up after being idle
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new Error('Could not reach the server. Check your connection and the server address.');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const detail = data?.detail;
      const message = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map((d: { msg?: string }) => d.msg || 'Invalid input.').join(' ')
        : `Request failed (${response.status}). Please try again.`;
      throw new ApiError(message, response.status);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  return {
    base,
    register: (email: string, password: string) => request<User>('/users', 'POST', { email, password }, null),
    async signIn(email: string, password: string) {
      const result = await request<{ access_token: string; token_type: string }>('/token', 'POST', { email, password }, null);
      if (!result?.access_token || result.token_type?.toLowerCase() !== 'bearer') throw new Error('The server returned an invalid login token.');
      return result.access_token;
    },
    me: (token?: string) => request<User>('/users/me', 'GET', undefined, token ?? getToken()),
    changePassword: (token: string, password: string) => request<User>('/users/me', 'PUT', { password1: password, password2: password }, token),

    devices: () => request<Device[]>('/devices'),
    updateDevice: (id: string, changes: Partial<Device>) => request<Device>(`/devices/${encodeURIComponent(id)}`, 'PATCH', changes),
    unpairDevice: (id: string) => request<void>(`/devices/${encodeURIComponent(id)}`, 'DELETE'),
    pairingInfo: (code: string) => request<PairingInfo>(`/pairing/${encodeURIComponent(code)}`),
    confirmPairing: (code: string) => request<void>(`/pairing/${encodeURIComponent(code)}/confirm`, 'POST'),

    async latest(): Promise<Record<string, Latest>> {
      const data = await request<Record<string, Latest> | { error: string }>('/latest');
      return 'error' in data ? {} : (data as Record<string, Latest>);
    },
    issues: () => request<Issue[]>('/issues'),
  };
}

export type Api = ReturnType<typeof createApi>;
