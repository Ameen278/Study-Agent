import { setIcon, type ItemView } from 'obsidian';
import { ChatError } from '../ChatService';

/**
 * Hover-copy icon and selection-copy behaviour for assistant bubbles.
 *
 * - A clipboard button (`.local-study-ai-copy`) is attached to each assistant
 *   bubble once, with the first token. It is a sibling of the content
 *   wrapper, so Markdown re-renders never remove it. Clicking copies the
 *   reply's current text — partial while streaming, complete afterwards.
 * - Selecting text inside a reply reveals that bubble's copy icon and makes
 *   the click copy only the selection (`Copy selected text`).
 * - Raw Markdown per bubble lives in a {@link CopyReplyController.replyTexts}
 *   WeakMap, updated on every token and read at click time rather than
 *   captured when the button was created.
 *
 * The controller registers DOM events on the view (cleaned up when the view
 * closes) and clears transient state in {@link CopyReplyController.detach}.
 */
export class CopyReplyController {
	private view: ItemView;
	private getMessagesEl: () => HTMLElement | null;

	/**
	 * Current raw Markdown per assistant bubble. Updated on every streamed
	 * token so the copy icon can copy the partial text mid-stream.
	 */
	private replyTexts = new WeakMap<HTMLElement, string>();
	/** Text of the current selection when it lies inside an assistant bubble. */
	private selectedText = '';
	/** Bubble that owns {@link selectedText}. */
	private selectedBubble: HTMLElement | null = null;

	constructor(view: ItemView, getMessagesEl: () => HTMLElement | null) {
		this.view = view;
		this.getMessagesEl = getMessagesEl;
	}

	/** Stores a bubble's current raw Markdown (called on every token). */
	setReplyText(bubble: HTMLElement, markdown: string): void {
		this.replyTexts.set(bubble, markdown);
	}

	/** The bubble's current raw Markdown (partial while streaming). */
	getReplyText(bubble: HTMLElement): string {
		return this.replyTexts.get(bubble) ?? '';
	}

	/** Starts selection tracking; called once from the view's `onOpen`. */
	activate(): void {
		this.view.registerDomEvent(document, 'selectionchange', () => {
			this.updateSelectionState();
		});
	}

	/** Clears transient selection state; called from the view's `onClose`. */
	detach(): void {
		this.selectedText = '';
		this.selectedBubble = null;
	}

	/**
	 * Creates the hover-copy icon button for an assistant bubble, once.
	 *
	 * The button shows a clipboard icon (`copy`) and becomes visible on bubble
	 * hover, on keyboard focus, or when the selection lies inside the bubble.
	 */
	ensureCopyButton(bubble: HTMLElement): void {
		if (bubble.querySelector('.local-study-ai-copy')) return;

		const copyButton = bubble.createEl('button', {
			cls: 'local-study-ai-copy',
			attr: {
				type: 'button',
				'aria-label': 'Copy reply',
			},
		});
		setIcon(copyButton, 'copy');

		// Prevent the pointer press from collapsing the text selection before
		// the click handler runs; keyboard activation (Tab + Enter) is unaffected.
		this.view.registerDomEvent(copyButton, 'pointerdown', (event) => {
			event.preventDefault();
		});

		this.view.registerDomEvent(copyButton, 'click', () => {
			void this.copyReply(bubble, copyButton);
		});
	}

	/**
	 * Records the current text selection when it lies inside an assistant
	 * bubble, reveals that bubble's copy icon, and updates its `aria-label`.
	 * Clears the recorded state when the selection is elsewhere or empty.
	 */
	private updateSelectionState(): void {
		const selection = window.getSelection();
		const range =
			selection && !selection.isCollapsed && selection.rangeCount > 0
				? selection.getRangeAt(0)
				: null;

		const anchor = selection?.anchorNode ?? null;
		const bubble = this.findAssistantBubble(anchor);

		const messagesEl = this.getMessagesEl();

		// Drop the reveal from every bubble first, then re-add on the owner.
		messagesEl
			?.querySelectorAll('.local-study-ai-copy-shown')
			.forEach((node) => node.removeClass('local-study-ai-copy-shown'));

		if (!range || !bubble) {
			this.selectedText = '';
			this.selectedBubble = null;
			messagesEl
				?.querySelectorAll('.local-study-ai-copy[aria-label]')
				.forEach((node) => node.setAttribute('aria-label', 'Copy reply'));
			return;
		}

		this.selectedText = range.toString();
		this.selectedBubble = bubble;
		bubble.addClass('local-study-ai-copy-shown');

		const button = bubble.querySelector('.local-study-ai-copy');
		button?.setAttribute('aria-label', 'Copy selected text');
	}

	/** Nearest assistant bubble containing `node`, or `null`. */
	private findAssistantBubble(node: Node | null): HTMLElement | null {
		if (!node) return null;
		const element = node.instanceOf(Element)
			? node
			: (node.parentElement ?? null);
		return element?.closest('.local-study-ai-message.assistant') ?? null;
	}

	/**
	 * Copies a reply to the clipboard: the recorded selection when it belongs
	 * to this bubble, otherwise the bubble's current raw Markdown (partial
	 * while streaming, complete afterwards). Shows the outcome as an icon on
	 * the button (`check` / `x`) for 1.5 seconds. The timer checks
	 * `isConnected` so it does not touch a button removed after the view
	 * closed.
	 */
	private async copyReply(
		bubble: HTMLElement,
		button: HTMLButtonElement,
	): Promise<void> {
		const useSelection =
			this.selectedBubble === bubble && this.selectedText !== '';
		const markdown = this.getReplyText(bubble);
		const text = useSelection ? this.selectedText : markdown;

		let icon = 'check';
		let label = useSelection ? 'Copied selection' : 'Copied';
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			icon = 'x';
			label = useSelection ? 'Copy selection failed' : 'Copy failed';
		}

		setIcon(button, icon);
		button.setAttribute('aria-label', label);

		window.setTimeout(() => {
			if (!button.isConnected) return;
			setIcon(button, 'copy');
			button.setAttribute('aria-label', 'Copy reply');
		}, 1500);
	}
}

/**
 * Appends a small styled error note under an already-rendered reply so the
 * partial answer stays readable while the failure is still visible.
 */
export function appendErrorNote(el: HTMLElement, error: unknown): void {
	const message =
		error instanceof ChatError
			? error.message
			: 'Unexpected error while contacting the AI provider.';
	el.createDiv({
		cls: 'local-study-ai-error',
		text: message,
	});
}
