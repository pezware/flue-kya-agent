import { describe, expect, it } from 'vitest';
import { CONSOLE_HTML } from './ui.ts';

// The console's script is embedded in a template literal, so every backslash in
// it is consumed once at build time. A single `\n` there emits a real newline
// into the page and leaves an unterminated string, which the browser rejects
// with "Invalid or unexpected token" — killing the whole script, not one line.
//
// tsc cannot see this: the TypeScript is valid either way. These tests read the
// emitted script and check it the way a browser would.

function consoleScript(): string {
	const match = CONSOLE_HTML.match(/<script>([\s\S]*?)<\/script>/);
	if (match === null) {
		throw new Error('CONSOLE_HTML carries no <script> block');
	}
	return match[1] as string;
}

describe('the console script', () => {
	it('is embedded in the page', () => {
		expect(consoleScript().length).toBeGreaterThan(1000);
	});

	it('parses as JavaScript', () => {
		// new Function compiles the body without running it, so a syntax error
		// throws here and anything else is left alone.
		expect(() => new Function(consoleScript())).not.toThrow();
	});

	it('keeps the SSE line delimiter as an escape, not a literal newline', () => {
		expect(consoleScript()).toContain("split('\\n')");
	});

	it('keeps the SSE frame delimiter as an escape, not two literal newlines', () => {
		expect(consoleScript()).toContain("indexOf('\\n\\n')");
	});
});
