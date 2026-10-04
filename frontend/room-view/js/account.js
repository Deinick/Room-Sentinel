// Account API: register, sign in, current user, change password, delete account.
// Ported from the first website (frontend/react-app/src/auth.ts, by Anton) to plain JS.
//   POST /users {email, password}         -> new account
//   POST /token {email, password}         -> bearer token
//   GET  /users/me                        -> {id, email}
//   PUT  /users/me {password1, password2} -> change password
//   DELETE /users/me                      -> delete account

// The local docker stack (docker-compose.yml) serves the API on :8000 next to the page.
export const DEFAULT_API = ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname)
  ? `http://${location.hostname}:8000`
  : 'https://stormhacks.onrender.com';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
// Same rule as the backend: 8-32 characters with at least one letter and one number.
export const validPassword = password =>
  password.length >= 8 && password.length <= 32 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
export const PASSWORD_RULE = '8–32 characters, with at least one letter and one number.';

export function accountApi(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');

  async function request(path, method, body, token) {
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        // the deployed server can take a while to wake up after being idle
        signal: AbortSignal.timeout(60000),
        cache: 'no-store',
      });
    } catch {
      throw new Error('Could not reach the server. Check your connection and the server address.');
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const detail = data?.detail;
      const message = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map(item => item.msg || 'Invalid input.').join(' ')
        : `Request failed (${response.status}). Please try again.`;
      throw new ApiError(message, response.status);
    }
    return response.status === 204 ? undefined : response.json();
  }

  return {
    base,
    register: (email, password) => request('/users', 'POST', { email, password }),
    async token(email, password) {
      const result = await request('/token', 'POST', { email, password });
      if (!result?.access_token || result.token_type?.toLowerCase() !== 'bearer') throw new Error('The server returned an invalid login token.');
      return result.access_token;
    },
    currentUser: token => request('/users/me', 'GET', undefined, token),
    changePassword: (token, password) => request('/users/me', 'PUT', { password1: password, password2: password }, token),
    deleteAccount: token => request('/users/me', 'DELETE', undefined, token),

    // Devices (docs/device-pairing.md): the user's side of pairing, and managing paired devices.
    devices: token => request('/devices', 'GET', undefined, token),
    pairingInfo: (token, code) => request(`/pairing/${encodeURIComponent(code)}`, 'GET', undefined, token),
    confirmPairing: (token, code) => request(`/pairing/${encodeURIComponent(code)}/confirm`, 'POST', undefined, token),
    updateDevice: (token, id, changes) => request(`/devices/${encodeURIComponent(id)}`, 'PATCH', changes, token),
    unpairDevice: (token, id) => request(`/devices/${encodeURIComponent(id)}`, 'DELETE', undefined, token),
  };
}

/** The pairing code from a QR link: …/room-view/#pair/CODE (or ?pair=CODE). */
export function pairingCodeFromUrl(loc = location) {
  const hash = loc.hash.match(/^#pair\/([A-Za-z0-9_-]{6,})/);
  if (hash) return hash[1];
  const query = new URLSearchParams(loc.search).get('pair');
  return query && /^[A-Za-z0-9_-]{6,}$/.test(query) ? query : null;
}
