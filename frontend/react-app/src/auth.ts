const API_BASE = ((import.meta as ImportMeta & { env: { VITE_API_BASE_URL?: string } }).env.VITE_API_BASE_URL || 'https://stormhacks.onrender.com').replace(/\/$/, '');

export type User = { id: number; email: string };
type Token = { access_token: string; token_type: string };
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(path: string, method: string, body?: unknown, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Could not reach the account server. Check your connection and try again.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const detail = data?.detail;
    const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((item: { msg?: string }) => item.msg || 'Invalid input.').join(' ') : `Account request failed (${response.status}). Please try again.`;
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const auth = {
  register: (email: string, password: string) => request<User>('/users', 'POST', { email, password }),
  token: async (email: string, password: string) => {
    const result = await request<Token>('/token', 'POST', { email, password });
    if (!result.access_token || result.token_type.toLowerCase() !== 'bearer') throw new Error('The server returned an invalid login token.');
    return result.access_token;
  },
  currentUser: (token: string) => request<User>('/users/me', 'GET', undefined, token),
  changePassword: (token: string, password: string) => request<User>('/users/me', 'PUT', { password1: password, password2: password }, token),
  deleteAccount: (token: string) => request<void>('/users/me', 'DELETE', undefined, token),
  devices: (token: string) => request<Device[]>('/devices', 'GET', undefined, token),
};

export type Device = { device_id: string; name: string | null };

export type LiveReading = { time: string; mode: 'demo' | 'device'; age_seconds: number; live: boolean; sensors: Record<string, { temp: number | null; status: string }> };
export type LiveFrame = { latest: Record<string, LiveReading>; issues: unknown[] };

/** Read GET /live (Server-Sent Events) until the stream ends or signal aborts. fetch rather than EventSource, which cannot send the bearer token. */
export async function streamLive(token: string, signal: AbortSignal, onFrame: (frame: LiveFrame) => void): Promise<void> {
  const response = await fetch(`${API_BASE}/live`, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal, cache: 'no-store' });
  if (!response.ok || !response.body) throw new ApiError(response.status === 401 ? 'Your session has expired. Sign in again.' : `Server returned ${response.status}.`, response.status);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const data = buffer.slice(0, end).split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      buffer = buffer.slice(end + 2);
      if (data) onFrame(JSON.parse(data) as LiveFrame);
    }
  }
}
