import { Hono } from 'hono';
import type { Presentation } from './policy.ts';

/**
 * What the routes need from a wallet.
 *
 * The Durable Object satisfies this, and so does a plain object in a test.
 * Depending on the shape rather than the binding is what lets these routes be
 * tested in Node, with no Workers runtime and no Flue module graph.
 */
export interface WalletHandle {
	store(sdJwt: string): Promise<{ ok: boolean; expiresAt?: number }>;
	present(): Promise<Presentation>;
	clear(): Promise<void>;
}

/**
 * The /wallet routes, over whichever wallet `resolve` returns for a request.
 *
 * No route ever returns the credential itself. Status says whether the wallet
 * can present one and, when it cannot, why — which is what an operator needs
 * and what an attacker cannot use.
 */
export function walletRoutes<B extends object>(resolve: (env: B) => WalletHandle) {
	const routes = new Hono<{ Bindings: B }>();

	routes.post('/credential', async (c) => {
		const body = await c.req.json<{ sdJwt?: string }>().catch(() => ({ sdJwt: undefined }));
		if (typeof body.sdJwt !== 'string' || body.sdJwt === '') {
			return c.json({ error: 'body must carry a non-empty sdJwt' }, 400);
		}
		const result = await resolve(c.env).store(body.sdJwt);
		if (!result.ok) {
			return c.json({ error: 'credential carries no readable exp claim' }, 422);
		}
		return c.json({ stored: true, expiresAt: result.expiresAt });
	});

	routes.get('/', async (c) => {
		const presentation = await resolve(c.env).present();
		return c.json(
			presentation.ok ? { canPresent: true } : { canPresent: false, reason: presentation.reason },
		);
	});

	routes.delete('/credential', async (c) => {
		await resolve(c.env).clear();
		return c.json({ cleared: true });
	});

	return routes;
}
