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
		name: 'KYA Agent',
		description:
			'External agent on Cloudflare Workers. Holds its own delegation credential in a Durable Object wallet and presents it to an identity-aware MCP gateway.',
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
				id: 'identity-aware-tool-use',
				name: 'Identity-aware tool use',
				description:
					'Reaches MCP tools through a gateway that verifies a delegation credential, and reports a refusal rather than working around it.',
				tags: ['mcp', 'mcp-i', 'kya', 'delegation', 'identity'],
			},
		],
		did,
	};
}
