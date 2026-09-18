import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Kya } from './agents/kya.ts';
import { isAuthorized } from './admin-auth.ts';
import type { AgentWallet } from './cloudflare.ts';
import { CONSOLE_HTML } from './ui.ts';
import { walletRoutes } from './wallet/routes.ts';

type Env = {
	AGENT_WALLET: DurableObjectNamespace<AgentWallet>;
	API_TOKEN?: string;
};

// One wallet per deployment, because this Worker carries one agent identity.
// When a deployment serves several identities, key the wallet by agent id
// instead and the rest of this file is unchanged.
const WALLET_INSTANCE = 'default';

// The console shell carries no secret, so it is served to anyone. Every call
// it then makes is gated. Listing exemptions here rather than registering the
// route above the middleware keeps the gate independent of route order: a
// route added later is gated unless its path is named here.
const PUBLIC_PATHS = new Set(['/']);

const app = new Hono<{ Bindings: Env }>();

// Every other route is gated, including the agent. This Worker is reachable
// from the open internet and holds both a model budget and a delegation
// credential, so an ungated default would hand both to anyone who found the
// URL. isAuthorized fails closed when API_TOKEN is unset.
app.use('*', async (c, next) => {
	if (PUBLIC_PATHS.has(new URL(c.req.url).pathname)) {
		return next();
	}
	if (!isAuthorized(c.req.header('authorization'), c.env.API_TOKEN)) {
		return c.json({ error: 'unauthorized' }, 401);
	}
	await next();
});

app.get('/', (c) => c.html(CONSOLE_HTML));

app.route(
	'/wallet',
	walletRoutes<Env>((env) => env.AGENT_WALLET.get(env.AGENT_WALLET.idFromName(WALLET_INSTANCE))),
);

// Talk to the agent with one POST per message, then read the conversation
// back from the same path:
//
//   curl -X POST http://localhost:5173/agents/kya/my-first-chat \
//     -H "authorization: Bearer $API_TOKEN" \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"What can you do?"}'
app.route('/agents/kya', createAgentRouter(Kya));

export default app;
