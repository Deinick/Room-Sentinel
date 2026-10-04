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
};
