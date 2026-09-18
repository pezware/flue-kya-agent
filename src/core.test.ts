import { beforeEach, describe, expect, it } from 'vitest';
import { createCore } from './core.ts';
import { publicJwkFrom } from './wallet/did.ts';
import { present, readExpiry } from './wallet/policy.ts';
import type { WalletHandle } from './wallet/routes.ts';

// These tests exercise the COMPOSED app, not the helpers it is built from.
// Deleting the auth middleware used to leave every other test green; the
// matrix below fails loudly if the gate stops covering a route.

const TOKEN = 'test-token';
const X = 'XKg2U_jUaiSb13LjBHtQetlxYJHID3Gg_ypbtwdz2J8';
const Y = 'JgDmYTJzhKX_dsgZLtO7N7CXxep9CUohDj0gBwonWPU';

type Env = { API_TOKEN?: string };

function fakeWallet(): WalletHandle {
	let stored: { sdJwt: string; expiresAt: number } | undefined;
	return {
		async store(sdJwt) {
			const expiresAt = readExpiry(sdJwt);
			if (expiresAt === undefined) return { ok: false, reason: 'no-exp' };
			stored = { sdJwt, expiresAt };
			return { ok: true, expiresAt };
		},
		async present() {
			return present(stored, Math.floor(Date.now() / 1000));
		},
		async clear() {
			stored = undefined;
		},
		async identity() {
			return { did: `did:jwk:${(await publicJwkFrom(X, Y)).kid}` };
		},
	};
}

let app: ReturnType<typeof createCore<Env>>;

beforeEach(() => {
	const wallet = fakeWallet();
	app = createCore<Env>({ wallet: () => wallet, token: (env) => env.API_TOKEN });
});

const env: Env = { API_TOKEN: TOKEN };
const withToken = { authorization: `Bearer ${TOKEN}` };

async function status(path: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
	const response = await app.request(path, { ...init, headers }, env);
	return response.status;
}

describe('public paths', () => {
	it('serves the console with no token', async () => {
		await expect(status('/')).resolves.toBe(200);
	});

	it('serves the agent card with no token', async () => {
		await expect(status('/.well-known/agent-card.json')).resolves.toBe(200);
	});

	it('publishes a did in the agent card', async () => {
		const card = (await (await app.request('/.well-known/agent-card.json', {}, env)).json()) as {
			did: string;
		};
		expect(card.did.startsWith('did:jwk:')).toBe(true);
	});
});

describe('the gate covers every other route', () => {
	const gated: [string, RequestInit][] = [
		['/identity', {}],
		['/wallet', {}],
		['/wallet/credential', { method: 'POST', body: '{}' }],
		['/wallet/credential', { method: 'DELETE' }],
	];

	for (const [path, init] of gated) {
		it(`refuses ${init.method ?? 'GET'} ${path} with no token`, async () => {
			await expect(status(path, {}, init)).resolves.toBe(401);
		});

		it(`refuses ${init.method ?? 'GET'} ${path} with the wrong token`, async () => {
			await expect(
				status(path, { authorization: 'Bearer wrong' }, init),
			).resolves.toBe(401);
		});
	}

	it('admits a gated route with the right token', async () => {
		await expect(status('/identity', withToken)).resolves.toBe(200);
	});
});

describe('an unset token', () => {
	it('refuses a gated route rather than admitting everyone', async () => {
		const response = await app.request('/wallet', { headers: withToken }, {} as Env);
		expect(response.status).toBe(401);
	});

	it('still serves the agent card, which carries no secret', async () => {
		const response = await app.request('/.well-known/agent-card.json', {}, {} as Env);
		expect(response.status).toBe(200);
	});
});

describe('an unknown route', () => {
	it('is not silently public', async () => {
		await expect(status('/not-a-route')).resolves.toBe(401);
	});
});
