import { MarkdownRenderer, type App, type Component } from 'obsidian';
import { replyContent, setBubbleText } from './bubbles';

/** Minimum gap between full Markdown re-renders while tokens stream in. */
const RENDER_INTERVAL_MS = 250;

/**
 * Throttled Markdown rendering pipeline for assistant bubbles.
 *
 * Streaming yields tokens faster than Markdown can sensibly be re-rendered,
 * so this queue coalesces them:
 *
 * - Only one timer ever exists: extra tokens while it is pending just
 *   overwrite {@link RenderQueue.pendingRender}, so the timer always renders
 *   the newest text and no callback can fire after `finish()` cleared it.
 *   The first token renders immediately because `lastRenderAt` starts at 0.
 * - Renders are chained onto {@link RenderQueue.renderChain} so each render
 *   starts only after the previous one resolved, which prevents flicker and
 *   overlapping DOM writes during fast streaming.
 *
 * The content wrapper (not the bubble) is emptied and filled, so siblings
 * such as the copy button survive every re-render. The `Thinking...`
 * placeholder class is removed on the first real render.
 */
export class RenderQueue {
	private app: App;
	private component: Component;
	/** Called after each successful render (creates the copy icon, stores text). */
	private onRendered: (bubble: HTMLElement, markdown: string) => void;

	private renderChain: Promise<void> = Promise.resolve();
	private lastRenderAt = 0;
	/** Id of the single pending throttle timer, or `null` when none. */
	private pendingRenderTimer: number | null = null;
	/** Newest render waiting on {@link pendingRenderTimer} (latest wins). */
	private pendingRender: { el: HTMLElement; markdown: string } | null = null;

	constructor(
		app: App,
		component: Component,
		onRendered: (bubble: HTMLElement, markdown: string) => void,
	) {
		this.app = app;
		this.component = component;
		this.onRendered = onRendered;
	}

	/**
	 * Queues a render of the latest partial Markdown, debounced to at most
	 * one call per {@link RENDER_INTERVAL_MS}.
	 */
	schedule(el: HTMLElement, markdown: string): void {
		this.pendingRender = { el, markdown };

		if (this.pendingRenderTimer !== null) return;

		const elapsed = Date.now() - this.lastRenderAt;
		const delay = Math.max(0, RENDER_INTERVAL_MS - elapsed);

		this.pendingRenderTimer = window.setTimeout(() => {
			this.pendingRenderTimer = null;
			const pending = this.pendingRender;
			this.pendingRender = null;
			if (pending) this.enqueue(pending.el, pending.markdown);
		}, delay);
	}

	/** Cancels the pending throttle timer, if any. */
	cancel(): void {
		if (this.pendingRenderTimer !== null) {
			window.clearTimeout(this.pendingRenderTimer);
			this.pendingRenderTimer = null;
		}
		this.pendingRender = null;
	}

	/**
	 * Ends a reply: cancels any pending throttled render, performs one last
	 * render of the final text, and runs the `onRendered` hook (copy icon,
	 * stored text). Cancelling first is what keeps the copy icon from being
	 * wiped — before that fix, the last token's timer fired after the final
	 * render and re-rendered (emptying) the bubble after the button was
	 * attached.
	 *
	 * @returns `false` when the reply was aborted with no text (the caller
	 *          should show `Stopped.` and skip recording history), `true`
	 *          when the bubble now holds the final text.
	 */
	async finish(
		bubble: HTMLElement,
		markdown: string,
		signal?: AbortSignal,
	): Promise<boolean> {
		this.cancel();
		await this.renderChain;
		if (signal?.aborted && !markdown.trim()) {
			setBubbleText(bubble, 'Stopped.');
			return false;
		}

		await this.renderInto(bubble, markdown);
		return true;
	}

	/** True while a render chain is still settling (tests/diagnostics). */
	isIdle(): boolean {
		return this.pendingRenderTimer === null && !this.pendingRender;
	}

	/**
	 * Chains a render onto {@link renderChain}; the chain ensures each render
	 * starts only after the previous one has resolved.
	 */
	private enqueue(el: HTMLElement, markdown: string): void {
		this.renderChain = this.renderChain.then(async () => {
			if (!el.isConnected) return;
			this.lastRenderAt = Date.now();
			await this.renderInto(el, markdown);
		});
	}

	/** Performs the actual `MarkdownRenderer.render` call. */
	private async renderInto(
		bubble: HTMLElement,
		markdown: string,
	): Promise<void> {
		const content = replyContent(bubble);
		content.empty();
		bubble.removeClass('local-study-ai-thinking');
		bubble.addClass('markdown-rendered');

		const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
		await MarkdownRenderer.render(
			this.app,
			markdown,
			content,
			sourcePath,
			this.component,
		);

		this.onRendered(bubble, markdown);
	}
}
