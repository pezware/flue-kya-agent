import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SKEW_SECONDS,
	boundTo,
	present,
	readConfirmationKey,
	readExpiry,
} from './policy.ts';

/** Build an SD-JWT presentation shaped like the ones agent-identity assembles. */
function sdJwt(claims: Record<string, unknown>, disclosures: string[] = []): string {
	const header = Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64url');
	const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
	const document = `${header}.${payload}.c2lnbmF0dXJl`;
	return `${document}~${disclosures.join('~')}${disclosures.length > 0 ? '~' : ''}`;
}

const NOW = 1_800_000_000;

describe('present', () => {
	it('returns the stored credential when it is still valid', () => {
		const credential = { sdJwt: 'a~b~', expiresAt: NOW + 3600 };
		expect(present(credential, NOW)).toEqual({ ok: true, header: 'a~b~' });
	});

	it('reports no-credential when the wallet is empty', () => {
		expect(present(undefined, NOW)).toEqual({ ok: false, reason: 'no-credential' });
	});

	it('reports expired once the credential is past its exp', () => {
		const credential = { sdJwt: 'a~', expiresAt: NOW - 1 };
		expect(present(credential, NOW)).toEqual({ ok: false, reason: 'expired' });
	});

	it('reports expired inside the skew window, before exp is reached', () => {
		const credential = { sdJwt: 'a~', expiresAt: NOW + DEFAULT_SKEW_SECONDS - 1 };
		expect(present(credential, NOW)).toEqual({ ok: false, reason: 'expired' });
	});

	it('honours a caller-supplied skew', () => {
		const credential = { sdJwt: 'a~', expiresAt: NOW + 120 };
		expect(present(credential, NOW, 300)).toEqual({ ok: false, reason: 'expired' });
	});
});

describe('readExpiry', () => {
	it('reads exp from a presentation carrying disclosures', () => {
		expect(readExpiry(sdJwt({ exp: NOW + 600 }, ['ZGlzY2xvc3VyZQ']))).toBe(NOW + 600);
	});

	it('reads exp from a presentation with no disclosures', () => {
		expect(readExpiry(sdJwt({ exp: NOW }))).toBe(NOW);
	});

	it('returns undefined when the document carries no exp', () => {
		expect(readExpiry(sdJwt({ vct: 'urn:example:Delegation' }))).toBeUndefined();
	});

	it('returns undefined for a string that is not a JWT', () => {
		expect(readExpiry('not-a-jwt')).toBeUndefined();
	});

	it('returns undefined rather than throwing on undecodable base64', () => {
		expect(readExpiry('aGVhZGVy.!!!not-base64!!!.c2ln')).toBeUndefined();
	});
});

describe('readConfirmationKey', () => {
	const key = { crv: 'P-256', x: 'XCOORD', y: 'YCOORD' };

	it('reads the key a credential is bound to', () => {
		expect(readConfirmationKey(sdJwt({ cnf: { jwk: { kty: 'EC', ...key } } }))).toEqual(key);
	});

	it('returns undefined when there is no cnf claim', () => {
		expect(readConfirmationKey(sdJwt({ exp: NOW }))).toBeUndefined();
	});

	it('returns undefined when cnf.jwk is missing its coordinates', () => {
		expect(readConfirmationKey(sdJwt({ cnf: { jwk: { kty: 'EC', crv: 'P-256' } } }))).toBeUndefined();
	});
});

describe('boundTo', () => {
	const key = { crv: 'P-256', x: 'XCOORD', y: 'YCOORD' };
	const credential = sdJwt({ cnf: { jwk: { kty: 'EC', ...key } } });

	it('accepts a credential bound to this exact key', () => {
		expect(boundTo(credential, key)).toBe(true);
	});

	it('refuses a credential bound to a different key', () => {
		expect(boundTo(credential, { ...key, x: 'SOMEONE-ELSE' })).toBe(false);
	});

	it('refuses a credential carrying no cnf claim at all', () => {
		expect(boundTo(sdJwt({ exp: NOW }), key)).toBe(false);
	});

	it('refuses a string that is not a JWT', () => {
		expect(boundTo('not-a-jwt', key)).toBe(false);
	});
});
