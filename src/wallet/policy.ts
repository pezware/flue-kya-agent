// Pure presentation policy for the agent's delegation credential.
//
// This module holds no state and touches no network, so every branch is
// unit-testable without a Workers runtime. The Durable Object in
// ../cloudflare.ts owns the storage and calls in here to decide what, if
// anything, goes on the wire.

/** A delegation credential as held by the wallet. */
export interface StoredCredential {
	/** SD-JWT presentation, `document~disclosure~...~`. */
	sdJwt: string;
	/** `exp` from the credential document, in epoch seconds. */
	expiresAt: number;
}

/** What the wallet hands back for one outbound request. */
export type Presentation =
	| { ok: true; header: string }
	| { ok: false; reason: 'no-credential' | 'expired' };

/**
 * Treat a credential as expired this many seconds early.
 *
 * A credential that passes here and expires in flight is rejected by the
 * verifier instead, which surfaces as an opaque 401 mid-conversation. Spending
 * a minute of validity buys a clear local failure.
 */
export const DEFAULT_SKEW_SECONDS = 60;

/**
 * Decide the `KYA-Credential` header value for one outbound request.
 *
 * Fails closed: an expired or absent credential yields no header and a named
 * reason, so the caller reports why it cannot reach the tool rather than
 * sending a request the gateway will reject.
 */
export function present(
	credential: StoredCredential | undefined,
	nowSeconds: number,
	skewSeconds: number = DEFAULT_SKEW_SECONDS,
): Presentation {
	if (credential === undefined) {
		return { ok: false, reason: 'no-credential' };
	}
	if (credential.expiresAt - skewSeconds <= nowSeconds) {
		return { ok: false, reason: 'expired' };
	}
	return { ok: true, header: credential.sdJwt };
}

/**
 * Read `exp` from an SD-JWT presentation, in epoch seconds.
 *
 * The presentation is `document~disclosure~...~`, so the issuer-signed
 * document is everything before the first tilde. Returns undefined when the
 * input is not a JWT carrying a numeric `exp`; the caller decides what that
 * means, because this module never throws.
 *
 * The signature is NOT verified here. The verifier does that. This only reads
 * a claim the wallet needs to know when to stop presenting the credential.
 */
export function readExpiry(sdJwt: string): number | undefined {
	const document = sdJwt.split('~')[0] ?? '';
	const payload = document.split('.')[1];
	if (payload === undefined || payload === '') {
		return undefined;
	}
	const claims = decodeBase64UrlJson(payload);
	if (claims === undefined) {
		return undefined;
	}
	const exp = (claims as Record<string, unknown>).exp;
	return typeof exp === 'number' ? exp : undefined;
}

function decodeBase64UrlJson(segment: string): unknown {
	const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
	try {
		return JSON.parse(atob(padded));
	} catch {
		return undefined;
	}
}
