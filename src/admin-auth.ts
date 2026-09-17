// Bearer check for every route this Worker serves.
//
// Pure and synchronous so it can be tested without a Workers runtime.

/**
 * Decide whether an Authorization header may reach this Worker.
 *
 * Fails closed on an unset secret. A deployment that forgets to set API_TOKEN
 * must refuse every request, never accept every request — these routes install
 * the agent's identity and spend its LLM budget, so an open default is the
 * worst possible one.
 *
 * The comparison is constant-time over the secret's length, so a caller cannot
 * recover the token one character at a time from response timing.
 */
export function isAuthorized(authorization: string | undefined, secret: string | undefined): boolean {
	if (secret === undefined || secret === '') {
		return false;
	}
	if (authorization === undefined) {
		return false;
	}
	const prefix = 'Bearer ';
	if (!authorization.startsWith(prefix)) {
		return false;
	}
	return constantTimeEquals(authorization.slice(prefix.length), secret);
}

function constantTimeEquals(a: string, b: string): boolean {
	// Length is not secret — a token's length leaks from the request size
	// anyway — but the comparison below must not short-circuit on content.
	if (a.length !== b.length) {
		return false;
	}
	let difference = 0;
	for (let i = 0; i < a.length; i += 1) {
		difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return difference === 0;
}
