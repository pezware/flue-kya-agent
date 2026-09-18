import { createAgentRouter } from '@flue/runtime/routing';
import { Kya } from './agents/kya.ts';
import type { AgentWallet } from './cloudflare.ts';
import { createCore } from './core.ts';

type Env = {
	AGENT_WALLET: DurableObjectNamespace<AgentWallet>;
	API_TOKEN?: string;
};

// One wallet per deployment, because this Worker carries one agent identity.
// When a deployment serves several identities, key the wallet by agent id
// instead and the rest of this file is unchanged.
const WALLET_INSTANCE = 'default';

// The route map lives in core.ts, which is testable without a Workers runtime.
// This file binds it to the real Durable Object and mounts the agent.
const app = createCore<Env>({
	wallet: (env) => env.AGENT_WALLET.get(env.AGENT_WALLET.idFromName(WALLET_INSTANCE)),
	token: (env) => env.API_TOKEN,
});

// Talk to the agent with one POST per message, then read the conversation
// back from the same path:
//
//   curl -X POST http://localhost:5173/agents/kya/my-first-chat \
//     -H "authorization: Bearer $API_TOKEN" \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"What can you do?"}'
app.route('/agents/kya', createAgentRouter(Kya));

export default app;
