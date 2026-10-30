/**
 * Small DOM helpers for chat bubbles.
 *
 * Every bubble has an inner `.local-study-ai-content` wrapper that holds the
 * visible text; everything that gets re-rendered or replaced targets that
 * wrapper, while the bubble itself keeps siblings such as the copy button and
 * error notes.
 */

/**
 * Adds a new message bubble of the given role to the messages list.
 *
 * The visible text lives in an inner `.local-study-ai-content` wrapper; the
 * bubble keeps siblings such as the copy button and error notes.
 */
export function appendMessage(
	messages: HTMLElement,
	role: 'user' | 'assistant',
	text: string,
): HTMLElement {
	const messageEl = messages.createDiv({
		cls: `local-study-ai-message ${role}`,
	});
	messageEl.createDiv({
		cls: 'local-study-ai-content',
		text,
	});
	messages.scrollTop = messages.scrollHeight;
	return messageEl;
}

/** The content wrapper inside a bubble (fallback: the bubble itself). */
export function replyContent(bubble: HTMLElement): HTMLElement {
	return bubble.querySelector<HTMLElement>('.local-study-ai-content') ?? bubble;
}

/**
 * Replaces a bubble's plain text (Stop and error outcomes) without touching
 * sibling buttons. Also clears the `Thinking...` placeholder styling so the
 * message reads normally.
 */
export function setBubbleText(bubble: HTMLElement, text: string): void {
	bubble.removeClass('local-study-ai-thinking');
	replyContent(bubble).setText(text);
}

/** Scrolls the message list to the bottom if the user is near the end. */
export function scrollToEnd(
	messages: HTMLElement | null,
	force = false,
): void {
	if (!messages) return;
	if (force) {
		messages.scrollTop = messages.scrollHeight;
		return;
	}
	const nearBottom =
		messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
	if (nearBottom) messages.scrollTop = messages.scrollHeight;
}
