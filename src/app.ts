import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { agentCard } from './agent-card.ts';
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

// Paths served to anyone. Listing exemptions here rather than registering the
// routes above the middleware keeps the gate independent of route order: a
// route added later is gated unless its path is named here.
//
//   /                              the console shell, which carries no secret
//   /.well-known/agent-card.json   the discovery document agent-manager fetches
//                                  server-side, with no credential to offer. It
//                                  publishes a DID and a capability list, both
//                                  public identifiers by design.
const PUBLIC_PATHS = new Set(['/', '/.well-known/agent-card.json']);

const app = new Hono<{ Bindings: Env }>();

function wallet(env: Env) {
	return env.AGENT_WALLET.get(env.AGENT_WALLET.idFromName(WALLET_INSTANCE));
}

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

// A2A discovery. agent-manager fetches this to register the agent, and issues
// a DelegationCredential against the DID it finds here.
app.get('/.well-known/agent-card.json', async (c) => {
	const { did } = await wallet(c.env).identity();
	return c.json(agentCard(did, new URL(c.req.url).origin));
});

// The agent's own identity, for an operator checking what was registered.
// Gated: not secret, but not something to publish beyond the card either.
app.get('/identity', async (c) => c.json(await wallet(c.env).identity()));

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
