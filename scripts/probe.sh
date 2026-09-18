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
# signature is never verified here — the wallet only reads the exp claim.
mk_sdjwt() { # $1 = seconds from now, or "none" for a credential with no exp
	python3 - "$1" <<'PY'
import base64, json, sys, time
def b64(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
claims = {"vct": "urn:iden2:ns:type:202503:DelegationCredential", "sub": "did:key:zProbe"}
if sys.argv[1] != "none":
    claims["exp"] = int(time.time()) + int(sys.argv[1])
print(f"{b64({'alg': 'ES256'})}.{b64(claims)}.c2lnbmF0dXJl~ZGlzY2xvc3VyZQ~")
PY
}

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

echo "== console shell is public"
check "GET / needs no token"            200 "$(code "$BASE/")"

echo "== auth gate"
check "no Authorization header"         401 "$(code "$BASE/wallet")"
check "wrong token"                     401 "$(code -H 'authorization: Bearer nope' "$BASE/wallet")"
check "correct token"                   200 "$(code -H "authorization: Bearer $API_TOKEN" "$BASE/wallet")"

echo "== empty wallet"
check "reports no-credential" \
	'{"canPresent":false,"reason":"no-credential"}' "$(auth "$BASE/wallet")"

echo "== storing a credential"
check "accepts one carrying exp"        200 "$(post_credential "{\"sdJwt\":\"$(mk_sdjwt 3600)\"}")"
check "wallet can now present"          '{"canPresent":true}' "$(auth "$BASE/wallet")"

echo "== refusals"
check "refuses a credential with no exp" 422 "$(post_credential "{\"sdJwt\":\"$(mk_sdjwt none)\"}")"
check "refuses a body with no sdJwt"     400 "$(post_credential '{}')"
check "refuses an empty sdJwt"           400 "$(post_credential '{"sdJwt":""}')"

post_credential "{\"sdJwt\":\"$(mk_sdjwt -10)\"}" >/dev/null
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
