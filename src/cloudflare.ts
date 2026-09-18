// Worker-level Cloudflare code lives here; HTTP routing stays in src/app.ts.
// Named exports become top-level Worker exports, so this is where an
// application-owned Durable Object class goes.
// https://flueframework.com/docs/guide/cloudflare-target/#extending-cloudflarets-entrypoint

import { DurableObject } from 'cloudflare:workers';
import { type PublicJwk, didFromJwk, publicJwkFrom } from './wallet/did.ts';
import { type Presentation, type StoredCredential, present, readExpiry } from './wallet/policy.ts';

/** The agent's public identity: the DID a credential is issued against. */
export interface AgentIdentity {
	did: string;
	jwk: PublicJwk;
}

/**
 * The agent's wallet: one delegation credential, held for the agent identity.
 *
 * WHY THIS IS NOT usePersistentState
 *
 * Flue scopes one agent Durable Object instance to one CONVERSATION, so state
 * stored through usePersistentState is per-conversation. A delegation
 * credential belongs to the agent identity and must outlive any single chat,
 * or every new conversation would need its own credential. So the wallet is an
 * application-owned DO, addressed by agent identity rather than conversation.
 *
 * It is deliberately small. A lightweight agent needs a holder, not a copy of
 * a wallet service: store a credential, present it, and later hold one key.
 */
export class AgentWallet extends DurableObject {
	/**
	 * Accept a credential into the wallet.
	 *
	 * `exp` is read from the credential itself rather than taken from the
	 * caller, so a bootstrap script cannot install a lifetime the issuer never
	 * granted. A credential with no readable `exp` is refused: the wallet
	 * cannot know when to stop presenting it, and presenting forever is worse
	 * than refusing now.
	 */
	async store(sdJwt: string): Promise<{ ok: boolean; expiresAt?: number }> {
		const expiresAt = readExpiry(sdJwt);
		if (expiresAt === undefined) {
			return { ok: false };
		}
		const credential: StoredCredential = { sdJwt, expiresAt };
		await this.ctx.storage.put('credential', credential);
		return { ok: true, expiresAt };
	}

	/** The `KYA-Credential` header value for one outbound request, or why there is none. */
	async present(): Promise<Presentation> {
		const credential = await this.ctx.storage.get<StoredCredential>('credential');
		return present(credential, Math.floor(Date.now() / 1000));
	}

	/** Drop the credential. Used when it is revoked upstream or rotated. */
	async clear(): Promise<void> {
		await this.ctx.storage.delete('credential');
	}

	/**
	 * The agent's DID, generating the key pair on first use.
	 *
	 * P-256 because that is the curve agent-identity binds a credential to:
	 * a DelegationCredential's `cnf.jwk` is the JWK encoded in this DID, and
	 * walt.id registers holders as P-256 (`keyType: secp256r1`).
	 *
	 * WHERE THE PRIVATE KEY LIVES, AND WHAT THAT DOES NOT PROMISE
	 *
	 * The key must survive a Durable Object restart, because the credential is
	 * bound to it and cannot be re-bound without re-issuance. A non-extractable
	 * CryptoKey cannot be stored: Durable Object storage rejects it with
	 * DataCloneError ("This type does not support serialization"). So the
	 * private key is generated EXTRACTABLE and persisted as a JWK.
	 *
	 * What that buys: the key never crosses a network, and only this Durable
	 * Object's code can read it. That is still better than the sidecar model it
	 * replaces, which fetches the credential from a wallet service over HTTP.
	 *
	 * What it does NOT buy: protection from this Worker's own code. A bug or a
	 * malicious deploy could export it. Do not describe it as non-extractable.
	 *
	 * Rotating the key abandons the credential bound to the old one, so this
	 * generates once and returns the same identity thereafter.
	 */
	async identity(): Promise<AgentIdentity> {
		const stored = await this.ctx.storage.get<AgentIdentity>('identity');
		if (stored !== undefined) {
			return stored;
		}

		// generateKey is typed CryptoKey | CryptoKeyPair because some algorithms
		// produce a single key; ECDSA always produces a pair.
		const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
			'sign',
			'verify',
		])) as CryptoKeyPair;

		const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as { x?: string; y?: string };
		if (typeof pub.x !== 'string' || typeof pub.y !== 'string') {
			throw new Error('generated P-256 public key is missing its coordinates');
		}

		const jwk = await publicJwkFrom(pub.x, pub.y);
		const identity: AgentIdentity = { did: didFromJwk(jwk), jwk };
		await this.ctx.storage.put('identity', identity);
		await this.ctx.storage.put('signingJwk', await crypto.subtle.exportKey('jwk', pair.privateKey));
		return identity;
	}
}
