# flue-kya-agent

A [Flue](https://flueframework.com) agent on Cloudflare Workers that holds its own
delegation credential and presents it to an identity-aware MCP gateway.

The agent is external by design. It runs in someone else's account, on someone
else's network, and proves who delegated authority to it with a credential it
carries — not with a sidecar, a shared network namespace, or an allowlisted IP.

## Why a Durable Object holds the wallet

Flue scopes one agent Durable Object instance to **one conversation**. A
delegation credential belongs to the agent identity and has to outlive any
single chat, so storing it through `usePersistentState` would hand every new
conversation an empty wallet.

The wallet is therefore an application-owned Durable Object
([`src/cloudflare.ts`](src/cloudflare.ts)), addressed by agent identity. It is
deliberately small — store a credential, present it, drop it. A lightweight
agent needs a holder, not a copy of a wallet service.

The presentation policy is a pure module
([`src/wallet/policy.ts`](src/wallet/policy.ts)) so every branch is testable
without a Workers runtime.

## Quickstart

```bash
mise install                 # node and pnpm, pinned in mise.toml
pnpm install
cp .dev.vars.example .dev.vars    # then fill in API_TOKEN
pnpm run dev                 # agent at /agents/kya
```

```bash
pnpm test                    # unit tests
pnpm run check:types
pnpm run build
```

Deploy to your own Cloudflare account:

```bash
pnpm exec wrangler secret put API_TOKEN
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm run deploy
```

## Routes

Every route requires `Authorization: Bearer $API_TOKEN`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/agents/kya/:conversation` | Send the agent one message |
| `POST` | `/wallet/credential` | Install the delegation credential (`{"sdJwt": "..."}`) |
| `GET` | `/wallet` | Whether the wallet can present, and why not if it cannot |
| `DELETE` | `/wallet/credential` | Drop the credential |

`GET /wallet` never returns the credential itself.

## Security posture

- **Every route is gated, including the agent.** This Worker is reachable from
  the open internet and holds both an LLM budget and a delegation credential.
- **An unset `API_TOKEN` refuses every request.** A deployment that forgets the
  secret fails closed.
- **The wallet reads `exp` from the credential**, not from the caller, so a
  bootstrap script cannot install a lifetime the issuer never granted.
- **Presentation fails closed** on an expired credential, 60 seconds early, so
  the failure is a clear local message rather than an opaque 401 mid-turn.
- **No gateway address is committed here.** Hostnames and credentials belong in
  wrangler secrets.

Dependencies carry a 5-day supply-chain maturity floor
(`minimumReleaseAge` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml)): a version
published less than 5 days ago will not install.

## Not done yet

- **The MCP client is not wired.** The agent holds a credential but does not yet
  call a gateway with it. That needs the gateway reachable from outside its own
  network.
- **The credential is installed by hand.** The successor is OID4VCI, where the
  wallet redeems a credential offer itself and `POST /wallet/credential`
  disappears.
- **No holder binding.** Credentials are presented as bearer tokens today. When
  the issuer requires a key-binding JWT, the wallet gains a non-extractable key
  and `present()` signs instead of replaying. The two-layer split exists so that
  change lands in one module.

## Licence

MIT
