import { beforeEach, describe, expect, it } from 'vitest';
import { present, readExpiry } from './policy.ts';
import { type WalletHandle, walletRoutes } from './routes.ts';

/** The Durable Object's behaviour, in memory. Same contract, no Workers runtime. */
function fakeWallet(): WalletHandle {
	let stored: { sdJwt: string; expiresAt: number } | undefined;
	return {
		async store(sdJwt) {
			const expiresAt = readExpiry(sdJwt);
			if (expiresAt === undefined) {
				return { ok: false };
			}
			stored = { sdJwt, expiresAt };
			return { ok: true, expiresAt };
		},
		async present() {
			return present(stored, Math.floor(Date.now() / 1000));
		},
		async clear() {
			stored = undefined;
		},
	};
}

function sdJwt(claims: Record<string, unknown>): string {
	const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'ES256' })}.${b64(claims)}.c2ln~ZGlzYw~`;
}

const now = () => Math.floor(Date.now() / 1000);

let app: ReturnType<typeof walletRoutes<Record<string, never>>>;

beforeEach(() => {
	const wallet = fakeWallet();
	app = walletRoutes<Record<string, never>>(() => wallet);
});

async function status(): Promise<unknown> {
	return (await app.request('/')).json();
}

async function install(body: unknown): Promise<number> {
	const response = await app.request('/credential', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	return response.status;
}

describe('GET /wallet', () => {
	it('reports no-credential when the wallet is empty', async () => {
		await expect(status()).resolves.toEqual({ canPresent: false, reason: 'no-credential' });
	});

	it('reports it can present once a valid credential is stored', async () => {
		await install({ sdJwt: sdJwt({ exp: now() + 3600 }) });
		await expect(status()).resolves.toEqual({ canPresent: true });
	});

	it('reports expired for a credential past its exp', async () => {
		await install({ sdJwt: sdJwt({ exp: now() - 10 }) });
		await expect(status()).resolves.toEqual({ canPresent: false, reason: 'expired' });
	});

	it('never returns the credential itself', async () => {
		const credential = sdJwt({ exp: now() + 3600 });
		await install({ sdJwt: credential });
		const text = await (await app.request('/')).text();
		expect(text).not.toContain(credential.slice(0, 20));
	});
});

describe('POST /wallet/credential', () => {
	it('accepts a credential carrying exp', async () => {
		await expect(install({ sdJwt: sdJwt({ exp: now() + 60 }) })).resolves.toBe(200);
	});

	it('refuses a credential with no readable exp', async () => {
		await expect(install({ sdJwt: sdJwt({ vct: 'urn:x' }) })).resolves.toBe(422);
	});

	it('refuses a body with no sdJwt', async () => {
		await expect(install({})).resolves.toBe(400);
	});

	it('refuses an empty sdJwt', async () => {
		await expect(install({ sdJwt: '' })).resolves.toBe(400);
	});

	it('refuses a body that is not JSON', async () => {
		const response = await app.request('/credential', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: 'not json',
		});
		expect(response.status).toBe(400);
	});
});

describe('DELETE /wallet/credential', () => {
	it('empties a wallet that held a credential', async () => {
		await install({ sdJwt: sdJwt({ exp: now() + 3600 }) });
		await app.request('/credential', { method: 'DELETE' });
		await expect(status()).resolves.toEqual({ canPresent: false, reason: 'no-credential' });
	});
});
