import { describe, expect, it } from 'vitest';
import { didFromJwk, jwkFromDid, jwkThumbprint, publicJwkFrom } from './did.ts';

// A freshly generated P-256 key, used only as a test vector. The same code path
// was checked against a real agent-identity DID during development and produced
// a byte-identical result, thumbprint included; that DID is not committed here
// because it belongs to a deployment this public repo should not describe.
const X = 'XKg2U_jUaiSb13LjBHtQetlxYJHID3Gg_ypbtwdz2J8';
const Y = 'JgDmYTJzhKX_dsgZLtO7N7CXxep9CUohDj0gBwonWPU';
const KID = 'hNX1ZRQzdV8RxwhFQ72GR64Fyd_-5EZmpqw-H9RkMsY';
const DID =
	'did:jwk:eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2Iiwia2lkIjoiaE5YMVpSUXpkVjhSeHdoRlE3MkdSNjRGeWRfLTVFWm1wcXctSDlSa01zWSIsIngiOiJYS2cyVV9qVWFpU2IxM0xqQkh0UWV0bHhZSkhJRDNHZ195cGJ0d2R6Mko4IiwieSI6IkpnRG1ZVEp6aEtYX2RzZ1pMdE83TjdDWHhlcDlDVW9oRGowZ0J3b25XUFUifQ';

describe('jwkThumbprint', () => {
	it('computes the RFC 7638 thumbprint of a P-256 key', async () => {
		await expect(jwkThumbprint(X, Y)).resolves.toBe(KID);
	});

	it('produces no base64 padding', async () => {
		await expect(jwkThumbprint(X, Y)).resolves.not.toContain('=');
	});

	it('changes when the key changes', async () => {
		const other = await jwkThumbprint(Y, X);
		expect(other).not.toBe(KID);
	});
});

describe('publicJwkFrom', () => {
	it('sets kid to the thumbprint', async () => {
		await expect(publicJwkFrom(X, Y)).resolves.toMatchObject({ kid: KID });
	});

	it('pins the curve to P-256', async () => {
		await expect(publicJwkFrom(X, Y)).resolves.toMatchObject({ kty: 'EC', crv: 'P-256' });
	});
});

describe('didFromJwk', () => {
	it('encodes the JWK as did:jwk', async () => {
		expect(didFromJwk(await publicJwkFrom(X, Y))).toBe(DID);
	});

	it('encodes the kid inside the DID, as agent-identity does', async () => {
		const decoded = jwkFromDid(didFromJwk(await publicJwkFrom(X, Y)));
		expect(decoded?.kid).toBe(KID);
	});
});

describe('jwkFromDid', () => {
	it('round-trips a DID back to its JWK', async () => {
		const jwk = await publicJwkFrom(X, Y);
		expect(jwkFromDid(didFromJwk(jwk))).toEqual(jwk);
	});

	it('returns undefined for a DID of another method', () => {
		expect(jwkFromDid('did:key:z6Mkabc')).toBeUndefined();
	});

	it('returns undefined for undecodable payload rather than throwing', () => {
		expect(jwkFromDid('did:jwk:!!!not-base64!!!')).toBeUndefined();
	});
});
