// Worker-level Cloudflare code lives here; HTTP routing stays in src/app.ts.
// Named exports become top-level Worker exports, so this is where an
// application-owned Durable Object class goes.
// https://flueframework.com/docs/guide/cloudflare-target/#extending-cloudflarets-entrypoint

import { DurableObject } from 'cloudflare:workers';
import { type Presentation, type StoredCredential, present, readExpiry } from './wallet/policy.ts';

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
}
