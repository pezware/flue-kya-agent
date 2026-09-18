#!/usr/bin/env bash
#
# Exercise every route that needs no model call, against a running Worker.
#
# The unit tests cover the same rules against an in-memory wallet. This proves
# them through the real Durable Object, the real auth middleware and the real
# HTTP surface — which is where the two console bugs lived, and where neither
# the unit tests nor the type checker could see them.
#
#   ./scripts/probe.sh                                   # local `pnpm run dev`
#   BASE=https://<name>.workers.dev ./scripts/probe.sh   # a deployed Worker
#
# The token comes from $API_TOKEN, or from .dev.vars when that is unset.
# No model is called, so this costs nothing and is deterministic.

set -u

BASE="${BASE:-http://localhost:5173}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${API_TOKEN:-}" ] && [ -f "$REPO_ROOT/.dev.vars" ]; then
	API_TOKEN="$(sed -nE 's/^API_TOKEN="(.*)"$/\1/p' "$REPO_ROOT/.dev.vars")"
fi
if [ -z "${API_TOKEN:-}" ]; then
	echo "no API_TOKEN: set it in the environment or in .dev.vars" >&2
	exit 2
fi

fails=0

# An SD-JWT shaped like the ones the identity gateway assembles:
# document~disclosure~ , where document is header.payload.signature. The
# signature is never verified here — the wallet reads only `exp` and `cnf`.
#
# `vct` is a placeholder on purpose. Nothing in this repo reads it, and a real
# credential type URN names the issuing organisation, which this public repo
# does not describe.
mk_sdjwt() { # $1 = seconds from now ("none" for no exp), $2 = cnf x, $3 = cnf y
	python3 - "$1" "${2:-}" "${3:-}" <<'PY'
import base64, json, sys, time
def b64(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
claims = {"vct": "urn:example:DelegationCredential"}
if sys.argv[1] != "none":
    claims["exp"] = int(time.time()) + int(sys.argv[1])
if sys.argv[2]:
    claims["cnf"] = {"jwk": {"kty": "EC", "crv": "P-256", "x": sys.argv[2], "y": sys.argv[3]}}
print(f"{b64({'alg': 'ES256'})}.{b64(claims)}.c2lnbmF0dXJl~ZGlzY2xvc3VyZQ~")
PY
}

# The agent's own key, so the probe can build a credential that is genuinely
# bound to it — and one that is not.
read -r AGENT_X AGENT_Y <<<"$(curl -s -H "authorization: Bearer $API_TOKEN" "$BASE/identity" \
	| python3 -c 'import json,sys; j=json.load(sys.stdin)["jwk"]; print(j["x"], j["y"])')"

check() { # $1 = name, $2 = expected, $3 = actual
	if [ "$2" = "$3" ]; then
		printf '  PASS  %-42s %s\n' "$1" "$3"
	else
		printf '  FAIL  %-42s expected=%s actual=%s\n' "$1" "$2" "$3"
		fails=$((fails + 1))
	fi
}

auth() { curl -s -H "authorization: Bearer $API_TOKEN" "$@"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post_credential() {
	code -X POST -H "authorization: Bearer $API_TOKEN" -H 'content-type: application/json' \
		-d "$1" "$BASE/wallet/credential"
}

echo "probing $BASE"

echo "== public surface"
check "GET / needs no token"            200 "$(code "$BASE/")"
# agent-manager fetches this server-side with no credential to offer, so it
# must answer unauthenticated or registration cannot work.
check "agent card needs no token"       200 "$(code "$BASE/.well-known/agent-card.json")"
check "agent card publishes a did:jwk"  "did:jwk" \
	"$(curl -s "$BASE/.well-known/agent-card.json" | sed -nE 's/.*"did":"(did:jwk):[^"]*".*/\1/p')"

echo "== auth gate"
check "no Authorization header"         401 "$(code "$BASE/wallet")"
check "identity route is gated"         401 "$(code "$BASE/identity")"
check "wrong token"                     401 "$(code -H 'authorization: Bearer nope' "$BASE/wallet")"
check "correct token"                   200 "$(code -H "authorization: Bearer $API_TOKEN" "$BASE/wallet")"

echo "== empty wallet"
check "reports no-credential" \
	'{"canPresent":false,"reason":"no-credential"}' "$(auth "$BASE/wallet")"

echo "== mutation routes are gated too"
check "POST credential needs a token"   401 \
	"$(code -X POST -H 'content-type: application/json' -d '{}' "$BASE/wallet/credential")"
check "DELETE credential needs a token" 401 "$(code -X DELETE "$BASE/wallet/credential")"

echo "== storing a credential"
check "accepts one bound to this agent" 200 \
	"$(post_credential "{\"sdJwt\":\"$(mk_sdjwt 3600 "$AGENT_X" "$AGENT_Y")\"}")"
check "wallet can now present"          '{"canPresent":true}' "$(auth "$BASE/wallet")"

echo "== refusals"
# The security check: a credential issued to a different holder must not be
# accepted, or the wallet would present somebody else's identity.
check "refuses one bound to another key" 422 \
	"$(post_credential "{\"sdJwt\":\"$(mk_sdjwt 3600 'NOT-THIS-AGENTS-X' "$AGENT_Y")\"}")"
check "refuses a credential with no cnf" 422 "$(post_credential "{\"sdJwt\":\"$(mk_sdjwt 3600)\"}")"
check "refuses a credential with no exp" 422 \
	"$(post_credential "{\"sdJwt\":\"$(mk_sdjwt none "$AGENT_X" "$AGENT_Y")\"}")"
check "refuses a body with no sdJwt"     400 "$(post_credential '{}')"
check "refuses an empty sdJwt"           400 "$(post_credential '{"sdJwt":""}')"

post_credential "{\"sdJwt\":\"$(mk_sdjwt -10 "$AGENT_X" "$AGENT_Y")\"}" >/dev/null
check "an expired credential cannot present" \
	'{"canPresent":false,"reason":"expired"}' "$(auth "$BASE/wallet")"

echo "== clearing"
check "clears the credential"           200 \
	"$(code -X DELETE -H "authorization: Bearer $API_TOKEN" "$BASE/wallet/credential")"
check "wallet is empty again" \
	'{"canPresent":false,"reason":"no-credential"}' "$(auth "$BASE/wallet")"

echo
if [ "$fails" -eq 0 ]; then
	echo "all checks passed"
else
	echo "$fails check(s) failed"
fi
exit "$fails"
