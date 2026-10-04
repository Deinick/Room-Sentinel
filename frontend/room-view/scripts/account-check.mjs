// Checks the account API client without touching real accounts: endpoints, payloads, bearer header,
// 204 deletion and error messages. Ported from frontend/react-app/scripts/auth-check.mjs (Anton).
//   node frontend/room-view/scripts/account-check.mjs
import assert from 'node:assert/strict';
import { ApiError, accountApi, validPassword, validEmail } from '../js/account.js';

const api = accountApi('https://example.test/');
const calls = [];
let response;
globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return response.clone(); };
const reply = (body, status = 200) => { response = new Response(status === 204 ? null : JSON.stringify(body), { status }); };

reply({ id: 7, email: 'user@example.com' }, 201);
await api.register('user@example.com', 'password123');
assert.equal(calls.at(-1).url, 'https://example.test/users');
assert.equal(calls.at(-1).method, 'POST');
assert.deepEqual(JSON.parse(calls.at(-1).body), { email: 'user@example.com', password: 'password123' });

reply({ access_token: 'test-token', token_type: 'bearer' });
assert.equal(await api.token('user@example.com', 'password123'), 'test-token');
assert.ok(calls.at(-1).url.endsWith('/token'));

reply({ id: 7, email: 'user@example.com' });
await api.currentUser('test-token');
assert.equal(calls.at(-1).method, 'GET');
assert.equal(calls.at(-1).headers.Authorization, 'Bearer test-token');

await api.changePassword('test-token', 'newpassword123');
assert.equal(calls.at(-1).method, 'PUT');
assert.deepEqual(JSON.parse(calls.at(-1).body), { password1: 'newpassword123', password2: 'newpassword123' });

reply(null, 204);
assert.equal(await api.deleteAccount('test-token'), undefined);
assert.equal(calls.at(-1).method, 'DELETE');

reply({ detail: 'Incorrect email or password.' }, 401);
await assert.rejects(api.token('user@example.com', 'wrongpass1'), e => e instanceof ApiError && e.status === 401 && e.message === 'Incorrect email or password.');
reply({ detail: [{ msg: 'Invalid email' }] }, 422);
await assert.rejects(api.register('bad', 'password123'), /Invalid email/);
reply({ access_token: 'x', token_type: 'mac' });
await assert.rejects(api.token('user@example.com', 'password123'), /invalid login token/);
globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
await assert.rejects(api.currentUser('test-token'), /Could not reach the server/);

assert.ok(validPassword('abcdefg1') && !validPassword('abcdefgh') && !validPassword('12345678') && !validPassword('a1'));
assert.ok(validEmail(' a@b.co ') && !validEmail('a@b') && !validEmail('no at.com'));
console.log('Account API client checks passed: endpoints, payloads, bearer header, 204 deletion, errors, validation.');
