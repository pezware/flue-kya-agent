import { describe, expect, it } from 'vitest';
import { isAuthorized } from './admin-auth.ts';

describe('isAuthorized', () => {
	it('accepts a bearer token equal to the secret', () => {
		expect(isAuthorized('Bearer s3cret', 's3cret')).toBe(true);
	});

	it('refuses a bearer token that differs from the secret', () => {
		expect(isAuthorized('Bearer wrong', 's3cret')).toBe(false);
	});

	it('refuses every request when the secret is unset', () => {
		expect(isAuthorized('Bearer anything', undefined)).toBe(false);
	});

	it('refuses every request when the secret is empty', () => {
		expect(isAuthorized('Bearer ', '')).toBe(false);
	});

	it('refuses a missing Authorization header', () => {
		expect(isAuthorized(undefined, 's3cret')).toBe(false);
	});

	it('refuses a scheme other than Bearer', () => {
		expect(isAuthorized('Basic s3cret', 's3cret')).toBe(false);
	});

	it('refuses a token that only shares a prefix with the secret', () => {
		expect(isAuthorized('Bearer s3c', 's3cret')).toBe(false);
	});
});
