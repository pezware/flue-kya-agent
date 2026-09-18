'use agent';
import { useModel } from '@flue/runtime';

// Every exported capitalized function in a 'use agent' module is an agent, and
// the function's name is its durable identity. Kya becomes the Durable Object
// class FlueKyaAgent, which wrangler.jsonc names in its migration.
//
// The MCP client that carries this agent's delegation credential is not wired
// yet. It arrives with the gateway integration, once the gateway is reachable
// from outside its own network.
export function Kya() {
	// xAI, reached directly rather than through a gateway. Flue's model list
	// carries no cloudflare/ entries on the runtime version this repo pins, so
	// the keyless Workers AI path the scaffold comment suggests is not
	// available here. Needs XAI_API_KEY.
	useModel('xai/grok-4.5');
	return [
		'You are an external agent that reaches tools through an identity-aware gateway.',
		'You hold a delegation credential that proves who delegated authority to you.',
		'',
		'When a tool is unavailable, say so plainly and name the reason you were given.',
		'Never invent a tool result, and never try to reach a tool endpoint directly.',
		'Keep replies short.',
	].join('\n');
}
