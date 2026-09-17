import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Kya } from './agents/kya.ts';
import { isAuthorized } from './admin-auth.ts';
import type { AgentWallet } from './cloudflare.ts';

type Env = {
	AGENT_WALLET: DurableObjectNamespace<AgentWallet>;
	API_TOKEN?: string;
};

// One wallet per deployment, because this Worker carries one agent identity.
// When a deployment serves several identities, key the wallet by agent id
// instead and the rest of this file is unchanged.
const WALLET_INSTANCE = 'default';

const app = new Hono<{ Bindings: Env }>();

// Every route is gated, including the agent itself. This Worker is reachable
// from the open internet and holds both an LLM budget and a delegation
// credential, so an ungated default would hand both to anyone who found the
// URL. isAuthorized fails closed when API_TOKEN is unset.
app.use('*', async (c, next) => {
	if (!isAuthorized(c.req.header('authorization'), c.env.API_TOKEN)) {
		return c.json({ error: 'unauthorized' }, 401);
	}
	await next();
});

function wallet(env: Env) {
	return env.AGENT_WALLET.get(env.AGENT_WALLET.idFromName(WALLET_INSTANCE));
}

// Bootstrap route: install the delegation credential issued to this agent.
// Today an operator pastes it here once. The successor is OID4VCI, where the
// wallet redeems a credential offer itself and this route disappears.
app.post('/wallet/credential', async (c) => {
	const body = await c.req.json<{ sdJwt?: string }>().catch(() => ({ sdJwt: undefined }));
	if (typeof body.sdJwt !== 'string' || body.sdJwt === '') {
		return c.json({ error: 'body must carry a non-empty sdJwt' }, 400);
	}
	const result = await wallet(c.env).store(body.sdJwt);
	if (!result.ok) {
		return c.json({ error: 'credential carries no readable exp claim' }, 422);
	}
	return c.json({ stored: true, expiresAt: result.expiresAt });
});

// Status route. It never returns the credential itself — only whether the
// wallet can present one, and when that stops being true.
app.get('/wallet', async (c) => {
	const presentation = await wallet(c.env).present();
	return c.json(
		presentation.ok ? { canPresent: true } : { canPresent: false, reason: presentation.reason },
	);
});

app.delete('/wallet/credential', async (c) => {
	await wallet(c.env).clear();
	return c.json({ cleared: true });
});

// Talk to the agent with one POST per message:
//
//   curl -X POST http://localhost:5173/agents/kya/my-first-chat \
//     -H "authorization: Bearer $API_TOKEN" \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"What can you do?"}'
app.route('/agents/kya', createAgentRouter(Kya));

export default app;
