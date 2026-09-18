import { Hono } from 'hono';
import { agentCard } from './agent-card.ts';
import { isAuthorized } from './admin-auth.ts';
import { CONSOLE_HTML } from './ui.ts';
import { type WalletHandle, walletRoutes } from './wallet/routes.ts';

// Everything this Worker serves EXCEPT the agent router.
//
// The agent router pulls in Flue's runtime and its 'use agent' module graph,
// which needs a Workers runtime to load. Keeping it out of here is what makes
// the gate and the route matrix testable in plain Node — and that matters,
// because deleting the auth middleware used to leave every unit test green.

// Paths served to anyone. Listing exemptions rather than registering routes
// above the middleware keeps the gate independent of route order: a route added
// later is gated unless its path is named here.
//
//   /                              the console shell, which carries no secret
//   /.well-known/agent-card.json   the discovery document a registering service
//                                  fetches server-side with no credential to
//                                  offer. It publishes a DID and a capability
//                                  list, both public identifiers by design.
export const PUBLIC_PATHS = new Set(['/', '/.well-known/agent-card.json']);

export interface CoreDeps<B extends object> {
	/** The wallet for a request's environment. */
	wallet: (env: B) => WalletHandle;
	/** The bearer token this deployment accepts. Undefined refuses everything. */
	token: (env: B) => string | undefined;
}

export function createCore<B extends object>(deps: CoreDeps<B>) {
	const app = new Hono<{ Bindings: B }>();

	// Every route not named public is gated, the agent included. This Worker is
	// reachable from the open internet and holds both a model budget and a
	// delegation credential, so an ungated default would hand both to anyone who
	// found the URL. isAuthorized fails closed when the token is unset.
	app.use('*', async (c, next) => {
		if (PUBLIC_PATHS.has(new URL(c.req.url).pathname)) {
			return next();
		}
		if (!isAuthorized(c.req.header('authorization'), deps.token(c.env))) {
			return c.json({ error: 'unauthorized' }, 401);
		}
		await next();
	});

	app.get('/', (c) => c.html(CONSOLE_HTML));

	// A2A discovery. A registering service fetches this and issues a delegation
	// credential against the DID it finds here.
	app.get('/.well-known/agent-card.json', async (c) => {
		const { did } = await deps.wallet(c.env).identity();
		return c.json(agentCard(did, new URL(c.req.url).origin));
	});

	// The agent's own identity, for an operator checking what was registered.
	// Gated: not secret, but not something to publish beyond the card either.
	app.get('/identity', async (c) => c.json(await deps.wallet(c.env).identity()));

	app.route('/wallet', walletRoutes<B>(deps.wallet));

	return app;
}
