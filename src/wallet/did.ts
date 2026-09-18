// did:jwk derivation for the agent's holder key.
//
// The agent's DID is the key the credential binds to. agent-identity issues a
// DelegationCredential whose `cnf.jwk` is byte-identical to the JWK encoded in
// this DID, so whatever is produced here becomes the confirmation key the
// verifier expects a holder to prove possession of.
//
// Pure and synchronous apart from the digest, so every branch is testable
// without a Workers runtime.

/** A public EC P-256 JWK, in the field order agent-identity emits. */
export interface PublicJwk {
	kty: 'EC';
	crv: 'P-256';
	kid: string;
	x: string;
	y: string;
}

/**
 * RFC 7638 JWK thumbprint, used as the `kid`.
 *
 * The spec is exact about the input: only the required members, lexicographic
 * by key, no whitespace. For an EC key that is crv, kty, x, y — note `kid`
 * itself is excluded, which is what stops the definition being circular.
 */
export async function jwkThumbprint(x: string, y: string): Promise<string> {
	const canonical = `{"crv":"P-256","kty":"EC","x":"${x}","y":"${y}"}`;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
	return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Build the public JWK for a P-256 key, with its thumbprint as `kid`.
 *
 * Field order matches the credentials agent-identity already issues, so a DID
 * produced here is directly comparable to one produced there.
 */
export async function publicJwkFrom(x: string, y: string): Promise<PublicJwk> {
	return { kty: 'EC', crv: 'P-256', kid: await jwkThumbprint(x, y), x, y };
}

/**
 * Encode a public JWK as a did:jwk identifier.
 *
 * did:jwk is base64url of the JWK's JSON with no padding. The encoding covers
 * the whole JWK including `kid`, matching what agent-identity registers.
 */
export function didFromJwk(jwk: PublicJwk): string {
	const json = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, kid: jwk.kid, x: jwk.x, y: jwk.y });
	return `did:jwk:${base64UrlEncode(new TextEncoder().encode(json))}`;
}

/** Decode a did:jwk back to its JWK. Returns undefined rather than throwing. */
export function jwkFromDid(did: string): PublicJwk | undefined {
	const prefix = 'did:jwk:';
	if (!did.startsWith(prefix)) {
		return undefined;
	}
	try {
		const json = new TextDecoder().decode(base64UrlDecode(did.slice(prefix.length)));
		const parsed = JSON.parse(json) as PublicJwk;
		return parsed.kty === 'EC' && typeof parsed.x === 'string' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlDecode(value: string): Uint8Array {
	const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
