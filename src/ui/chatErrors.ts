import { ChatError } from '../ChatService';

/** True when the error is an `AbortError` from a cancelled fetch. */
export function isAbortError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error as { name?: string }).name === 'AbortError'
	);
}

/**
 * True when the error looks like a network/CORS failure from `fetch`
 * (`TypeError: Failed to fetch`), i.e. streaming is unavailable and the
 * non-streaming fallback should be attempted.
 */
export function isNetworkTypeError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error as { name?: string }).name === 'TypeError'
	);
}

/**
 * User-facing message for a failed send: the `ChatError` text when the
 * provider reported a known failure, the original `Error` message when there
 * is one, and a generic fallback otherwise.
 */
export function toChatErrorMessage(error: unknown): string {
	if (error instanceof ChatError) return error.message;
	if (error instanceof Error && error.message !== '') return error.message;
	return 'Unexpected error while contacting the AI provider.';
}
