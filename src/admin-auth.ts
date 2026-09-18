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
	// No early return on a length mismatch. An earlier version returned
	// immediately and justified it by claiming a token's length leaks from the
	// request size — which is false: the request size reveals the length of the
	// CALLER's input, never the secret's. A caller could therefore have sampled
	// the timing difference to learn how long the secret is.
	//
	// Folding the length difference into the accumulator and always walking the
	// longer of the two removes that signal.
	let difference = a.length ^ b.length;
	const span = Math.max(a.length, b.length);
	for (let i = 0; i < span; i += 1) {
		// charCodeAt past the end is NaN, and NaN ^ n is n, so a shorter string
		// still contributes a difference rather than silently matching.
		difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
	}
	return difference === 0;
}
