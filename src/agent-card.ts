// The A2A Agent Card this Worker publishes for discovery.
//
// agent-identity's agent-manager registers an agent by fetching
// <base>/.well-known/agent-card.json and reading this document. It parses the
// card as free-form JSON and validates nothing, so the shape below mirrors the
// A2A struct that agent-identity's own proxy serves — the `did` field is the
// one that matters, because a DelegationCredential is issued against it.

export interface AgentCard {
	name: string;
	description: string;
	version: string;
	provider: { organization: string; url: string };
	documentationUrl?: string;
	capabilities: { streaming: boolean; pushNotifications: boolean };
	supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string }[];
	defaultInputModes: string[];
	defaultOutputModes: string[];
	skills: { id: string; name: string; description: string; tags: string[] }[];
	did: string;
}

/**
 * Build the card for this deployment.
 *
 * `origin` comes from the request rather than configuration, so the card is
 * correct on workers.dev, on a custom domain and in local dev without a
 * deployment-specific setting — and without this public repo naming any host.
 */
export function agentCard(did: string, origin: string): AgentCard {
	return {
		// The card must describe what this agent CAN do, not what it is meant to
		// do. A registering operator delegates authority on the strength of this
		// document, and in an identity system an unhonoured claim is the wrong
		// thing to publish. Update it when the gateway client lands, not before.
		name: 'KYA Agent',
		description:
			'External agent on Cloudflare Workers. Holds a delegation credential bound to its own key in a Durable Object wallet. Tool use through a verifying gateway is not wired yet.',
		version: '0.1.0',
		provider: {
			organization: 'pezware',
			url: 'https://github.com/pezware/flue-kya-agent',
		},
		documentationUrl: 'https://github.com/pezware/flue-kya-agent#readme',
		capabilities: { streaming: true, pushNotifications: false },
		supportedInterfaces: [
			{ url: `${origin}/agents/kya`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
		],
		defaultInputModes: ['text/plain', 'application/json'],
		defaultOutputModes: ['text/plain', 'application/json'],
		skills: [
			{
				id: 'conversation',
				name: 'Conversation',
				description:
					'Answers questions over the A2A interface above. Reports a refusal plainly rather than working around it.',
				tags: ['conversation', 'a2a'],
			},
		],
		did,
	};
}
