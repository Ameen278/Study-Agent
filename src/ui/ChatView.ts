import { ItemView, WorkspaceLeaf } from 'obsidian';
import {
	activeModelLabel,
	ChatError,
	createChatService,
} from '../ChatService';
import type { ChatMessage } from '../ChatService';
import type ObsidianAgentPlugin from '../main';
import { allSkills, findSkill } from '../skills';
import { buildActiveFileContext } from './activeFileContext';
import {
	appendMessage,
	scrollToEnd,
	setBubbleText,
} from './bubbles';
import { appendErrorNote, CopyReplyController } from './copyReply';
import {
	isAbortError,
	isNetworkTypeError,
	toChatErrorMessage,
} from './chatErrors';
import { RenderQueue } from './renderQueue';
import { composeSystemPrompt } from './systemPrompt';

export const VIEW_TYPE_CHAT = 'local-study-ai-chat';

/**
 * Sidebar chat view.
 *
 * The view owns the conversation history, the form, and the send/stop
 * orchestration. Everything else is delegated to small collaborators:
 *
 * - `RenderQueue` (renderQueue.ts) — throttled Markdown rendering pipeline.
 * - `CopyReplyController` (copyReply.ts) — hover-copy icon and selection copy.
 * - `bubbles.ts` — DOM helpers for message bubbles.
 * - `activeFileContext.ts` — builds the active-note context block; with
 *   `systemPrompt.ts` (always-on study-assistant identity, the selected
 *   skill, and custom instructions) it forms the request's system prompt.
 * - `skills.ts` — skill registry behind the Skill dropdown (built-in and
 *   custom skills).
 * - `chatErrors.ts` — abort/network detection and error messages.
 * - `createChatService` (ChatService.ts) — the provider client (Ollama, OpenAI,
 *   Anthropic, OpenRouter, Groq, Gemini, custom).
 *
 * Settings are read on every send so changing the provider, URL, or model
 * takes effect without reopening the view. A `Provider · model` line under
 * the textarea shows what the next message will use, refreshed on every
 * settings change.
 *
 * Replies stream token by token via the service's `chatStream`; if streaming
 * fails before the first token (typically CORS), the view falls back to the
 * non-streaming `chat`. An assistant bubble shows `Thinking...` until the
 * first token arrives. The form has two switches — active-file context and
 * thinking mode; the thinking switch is only shown for Ollama.
 */
export class ChatView extends ItemView {
	private readonly plugin: ObsidianAgentPlugin;
	private history: ChatMessage[] = [];
	private isSending = false;
	private messagesEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private sendButtonEl: HTMLButtonElement | null = null;
	private contextCheckboxEl: HTMLInputElement | null = null;
	private thinkCheckboxEl: HTMLInputElement | null = null;
	/** Wrapper label of the thinking switch; hidden for non-Ollama providers. */
	private thinkToggleEl: HTMLElement | null = null;
	/** Line under the textarea showing the active `Provider · model`. */
	private modelInfoEl: HTMLElement | null = null;
	/** Skill dropdown (view state; resets to None when the sidebar reopens). */
	private skillSelectEl: HTMLSelectElement | null = null;
	private abortController: AbortController | null = null;
	/** Throttled Markdown rendering pipeline (also cancels in `onClose`). */
	private renderQueue: RenderQueue;
	/** Copy icon + selection-copy behaviour for assistant bubbles. */
	private copyController: CopyReplyController;
	/** Unsubscribes from plugin settings changes; cleared in `onClose()`. */
	private unsubscribeSettings: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ObsidianAgentPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.renderQueue = new RenderQueue(this.app, this, (bubble, markdown) =>
			this.onReplyRendered(bubble, markdown),
		);
		this.copyController = new CopyReplyController(this, () => this.messagesEl);
	}

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		return 'Local study AI';
	}

	getIcon(): string {
		return 'bot';
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('local-study-ai-chat');

		this.history = [];

		const heading = contentEl.createEl('h3', { text: 'Local study AI' });
		heading.setAttribute('aria-label', 'Local study AI chat');

		const messages = contentEl.createDiv({
			cls: 'local-study-ai-messages',
		});
		messages.setAttribute('aria-live', 'polite');
		this.messagesEl = messages;

		const form = contentEl.createEl('form', {
			cls: 'local-study-ai-form',
		});

		const input = form.createEl('textarea', {
			attr: {
				placeholder: 'Ask your local AI...',
				rows: '3',
				'aria-label': 'Message to local AI',
			},
		});
		this.inputEl = input;

		// Provider · model under the writing field, kept in sync with settings.
		const modelInfo = form.createDiv({
			cls: 'local-study-ai-model-info',
		});
		this.modelInfoEl = modelInfo;
		this.updateModelInfo();

		// Row with the two form switches: active-file context and thinking mode.
		const toggles = form.createDiv({ cls: 'local-study-ai-toggles' });

		// Context switch on the interface
		const contextToggle = toggles.createEl('label', {
			cls: 'local-study-ai-switch',
		});

		const checkbox = contextToggle.createEl('input', {
			attr: {
				type: 'checkbox',
			},
		});

		this.contextCheckboxEl = checkbox;

		contextToggle.createSpan({
			text: 'Use Active File as Context',
		});

		// Thinking switch: reads and writes the saved setting. Only Ollama
		// honours it, so the switch is hidden for other providers.
		const thinkToggle = toggles.createEl('label', {
			cls: 'local-study-ai-switch',
		});

		const thinkCheckbox = thinkToggle.createEl('input', {
			attr: {
				type: 'checkbox',
			},
		});
		thinkCheckbox.checked = this.plugin.settings.ollamaThink;
		this.thinkCheckboxEl = thinkCheckbox;
		this.thinkToggleEl = thinkToggle;

		thinkToggle.createSpan({
			text: 'Enable thinking',
		});

		this.updateThinkSwitchVisibility();

		this.registerDomEvent(thinkCheckbox, 'change', () => {
			this.plugin.settings.ollamaThink = thinkCheckbox.checked;
			void this.plugin.saveSettings();
		});

		// Skill dropdown: sticky view state next to the switches. Options
		// refresh whenever settings change (custom skills added, edited, or
		// deleted in the settings tab).
		const skillLabel = toggles.createEl('label', {
			cls: 'local-study-ai-skill',
		});
		skillLabel.createSpan({ text: 'Skill' });
		const skillSelect = skillLabel.createEl('select', {
			cls: 'local-study-ai-skill-select',
			attr: { 'aria-label': 'Skill' },
		});
		this.skillSelectEl = skillSelect;
		this.populateSkillOptions();

		// Keep the switch and the model line current when settings change
		// elsewhere, for example in the settings tab while the sidebar is open.
		this.unsubscribeSettings = this.plugin.registerSettingsListener(() => {
			if (this.thinkCheckboxEl) {
				this.thinkCheckboxEl.checked = this.plugin.settings.ollamaThink;
			}
			this.updateThinkSwitchVisibility();
			this.populateSkillOptions();
			this.updateModelInfo();
		});

		// Track selections inside assistant bubbles so the copy icon can copy
		// just the selected part of a reply.
		this.copyController.activate();

		const sendButton = form.createEl('button', {
			text: 'Send',
			attr: {
				type: 'submit',
				'aria-label': 'Send message',
			},
		});
		this.sendButtonEl = sendButton;

		this.registerDomEvent(form, 'submit', (event) => {
			event.preventDefault();
			void this.sendMessage();
		});

		this.registerDomEvent(input, 'keydown', (event) => {
			if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				form.requestSubmit();
			}
		});
	}

	// ===================================================================
	private async sendMessage(): Promise<void> {
		// While a reply is streaming, the Send button doubles as Stop.
		if (this.isSending) {
			this.abortController?.abort();
			return;
		}

		const input = this.inputEl;
		const messages = this.messagesEl;
		if (!input || !messages) return;

		const prompt = input.value.trim();
		if (!prompt) return;

		this.setSending(true);
		input.value = '';

		appendMessage(messages, 'user', prompt);
		this.history.push({ role: 'user', content: prompt });

		// Keep "Thinking..." visible until the first token replaces it; the
		// class styles it as a muted placeholder.
		const replyEl = appendMessage(messages, 'assistant', 'Thinking...');
		replyEl.addClass('local-study-ai-thinking');

		const controller = new AbortController();
		this.abortController = controller;

		let partial = '';

		try {
			const service = createChatService(this.plugin.settings);

			const activeFileContext = await buildActiveFileContext(
				this.app,
				this.contextCheckboxEl?.checked ?? false,
			);
			const options = {
				think: this.plugin.settings.ollamaThink,
				system: composeSystemPrompt({
					skill: findSkill(
						this.skillSelectEl?.value ?? '',
						this.plugin.settings,
					),
					customInstructions: this.plugin.settings.customInstructions,
					activeFileContext,
				}),
			};

			try {
				for await (const delta of service.chatStream(
					this.history,
					options,
					controller.signal,
				)) {
					partial += delta;
					this.copyController.setReplyText(replyEl, partial);
					this.renderQueue.schedule(replyEl, partial);
				}
			} catch (streamError) {
				// A user-initiated stop is not a failure; keep whatever text
				// already arrived.
				if (isAbortError(streamError)) {
					if (partial.trim()) {
						await this.finishPartial(replyEl, partial, controller.signal);
						return;
					}
					this.history.pop();
					setBubbleText(replyEl, 'Stopped.');
					return;
				}

				// fetch rejects with a TypeError (CORS/network) before any token
				// arrives when streaming is blocked; fall back to the
				// non-streaming chat() which uses requestUrl (no CORS).
				if (partial === '' && isNetworkTypeError(streamError)) {
					partial = await service.chat(this.history, options);
					this.copyController.setReplyText(replyEl, partial);
					await this.finishPartial(replyEl, partial, controller.signal);
					return;
				}

				// Real error, possibly after some tokens arrived.
				if (partial.trim()) {
					await this.finishPartial(replyEl, partial, controller.signal);
					appendErrorNote(replyEl, streamError);
					return;
				}
				throw streamError;
			}

			// A normal completion must produce text, matching chat()'s empty
			// check — otherwise the bubble would end up blank.
			if (!partial.trim()) {
				throw new ChatError(
					'The AI returned an empty response. Check that the selected model is installed and supports chat.',
				);
			}

			// Stream finished normally.
			await this.finishPartial(replyEl, partial, controller.signal);
		} catch (error) {
			if (isAbortError(error)) {
				if (partial.trim()) {
					await this.finishPartial(replyEl, partial, controller.signal);
					return;
				}
				this.history.pop();
				setBubbleText(replyEl, 'Stopped.');
				return;
			}

			setBubbleText(replyEl, toChatErrorMessage(error));
			this.history.pop();
		} finally {
			if (this.abortController === controller) {
				this.abortController = null;
			}
			this.setSending(false);
			input.focus();
			scrollToEnd(this.messagesEl, true);
		}
	}

	/**
	 * Ends a reply: lets the render queue perform the final render (copy icon
	 * included), records the raw Markdown in history, and scrolls down. The
	 * queue returns `false` for an aborted empty reply (`Stopped.` shown
	 * instead), which must not enter history.
	 */
	private async finishPartial(
		bubble: HTMLElement,
		markdown: string,
		signal?: AbortSignal,
	): Promise<void> {
		const recorded = await this.renderQueue.finish(bubble, markdown, signal);
		if (!recorded) return;

		this.history.push({ role: 'assistant', content: markdown });
		scrollToEnd(this.messagesEl, true);
	}

	/**
	 * Render-queue callback: stores the bubble's raw Markdown for the copy
	 * icon (read at click time) and creates the button once, with the first
	 * token. Paths that never streamed (the non-streaming fallback) call
	 * {@link finishPartial}, whose final render runs this hook too.
	 */
	private onReplyRendered(bubble: HTMLElement, markdown: string): void {
		this.copyController.setReplyText(bubble, markdown);
		this.copyController.ensureCopyButton(bubble);
	}

	/**
	 * Toggles the sending state. While sending, the Send button stays enabled
	 * and becomes Stop so the user can cancel a streaming reply.
	 */
	private setSending(sending: boolean): void {
		this.isSending = sending;

		if (this.inputEl) {
			this.inputEl.disabled = sending;
		}

		if (this.sendButtonEl) {
			this.sendButtonEl.disabled = false;
			this.sendButtonEl.setText(sending ? 'Stop' : 'Send');
			this.sendButtonEl.setAttribute(
				'aria-label',
				sending ? 'Stop reply' : 'Send message',
			);
		}
	}

	/**
	 * Shows the thinking switch only while Ollama is the active provider.
	 * Other providers ignore the `think` option, so the control would be
	 * misleading.
	 */
	private updateThinkSwitchVisibility(): void {
		if (!this.thinkToggleEl) return;
		this.thinkToggleEl.style.display =
			this.plugin.settings.provider === 'ollama' ? '' : 'none';
	}

	/** Refreshes the `Provider · model` line under the textarea. */
	private updateModelInfo(): void {
		this.modelInfoEl?.setText(activeModelLabel(this.plugin.settings));
	}

	/**
	 * Rebuilds the Skill dropdown options from the registry (built-ins +
	 * custom skills). Keeps the current selection when the skill still
	 * exists; otherwise resets to None.
	 */
	private populateSkillOptions(): void {
		const select = this.skillSelectEl;
		if (!select) return;

		const previous = select.value;
		const skills = allSkills(this.plugin.settings);
		select.empty();

		const none = select.createEl('option', { text: 'None' });
		none.value = '';
		for (const skill of skills) {
			const option = select.createEl('option', { text: skill.name });
			option.value = skill.id;
		}

		select.value = skills.some((skill) => skill.id === previous)
			? previous
			: '';
	}

	async onClose(): Promise<void> {
		this.abortController?.abort();
		this.abortController = null;
		this.renderQueue.cancel();
		this.copyController.detach();
		this.unsubscribeSettings?.();
		this.unsubscribeSettings = null;
		this.messagesEl = null;
		this.inputEl = null;
		this.sendButtonEl = null;
		this.contextCheckboxEl = null;
		this.thinkCheckboxEl = null;
		this.thinkToggleEl = null;
		this.modelInfoEl = null;
		this.skillSelectEl = null;
	}
}
