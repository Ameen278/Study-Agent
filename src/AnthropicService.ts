import { requestUrl } from 'obsidian';
import {
	ChatError,
	chatHttpError,
	normalizeBaseUrl,
	parseAnthropicSseData,
	readSseStream,
	type ChatMessage,
	type ChatOptions,
	type ChatService,
} from './ChatService';

/** Response shape of `POST {base}/v1/messages` (non-streaming). */
interface AnthropicMessagesResponse {
	content?: Array<{ type?: unknown; text?: unknown }>;
}

/** Response shape of `GET {base}/v1/models`. */
interface AnthropicModelsResponse {
	data?: Array<{ id?: unknown }>;
}

/**
 * Client for Anthropic's Messages API (Claude models).
 *
 * Differences from the OpenAI format that matter here:
 *
 * - The API key goes in an `x-api-key` header instead of `Authorization`.
 * - An `anthropic-version` header is required on every request.
 * - System prompts are a top-level `system` field, **not** a system-role
 *   message — sending a `system` message inside `messages` is rejected.
 * - `max_tokens` is mandatory, so the plugin defaults it to 2048.
 *
 * Streaming uses `text/event-stream` with named events; only
 * `content_block_delta` (text pieces) and `message_stop` (end) matter here.
 * The `think` option is ignored — Claude's extended thinking is not wired up
 * in this plugin.
 */
export class AnthropicService implements ChatService {
	private baseUrl: string;
	private apiKey: string;
	private defaultModel: string;

	/**
	 * @param baseUrl     API root, e.g. `https://api.anthropic.com`.
	 * @param apiKey      Anthropic API key (`sk-ant-...`).
	 * @param defaultModel Model used when a request does not specify one.
	 */
	constructor(baseUrl: string, apiKey: string, defaultModel: string) {
		this.baseUrl = normalizeBaseUrl(baseUrl, 'https://api.anthropic.com');
		this.apiKey = apiKey.trim();
		this.defaultModel = defaultModel.trim();
	}

	/**
	 * Lists the Claude model ids available to this API key
	 * (`GET {base}/v1/models`).
	 */
	async listModels(): Promise<string[]> {
		const body = await this.requestText('/v1/models', 'GET');
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			throw new ChatError(
				'Anthropic returned an invalid JSON response from /v1/models.',
			);
		}

		const response = parsed as AnthropicModelsResponse;
		if (!Array.isArray(response.data)) return [];

		const ids: string[] = [];
		for (const entry of response.data) {
			if (typeof entry?.id === 'string' && entry.id) ids.push(entry.id);
		}
		return ids;
	}

	/**
	 * Sends the conversation and returns the full reply text
	 * (`POST {base}/v1/messages` with `stream: false`).
	 *
	 * @throws {ChatError} When no model/key is configured, the request fails,
	 *         or Anthropic returns an empty reply.
	 */
	async chat(
		messages: ChatMessage[],
		options: ChatOptions = {},
	): Promise<string> {
		const payload = this.buildPayload(messages, options, false);

		const body = await this.requestText('/v1/messages', 'POST', payload);
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			throw new ChatError('Anthropic returned an invalid JSON response.');
		}

		const response = parsed as AnthropicMessagesResponse;
		const text = this.extractText(response);
		if (!text) {
			throw new ChatError(
				'Anthropic returned an empty response. Check that the selected model exists and supports the Messages API.',
			);
		}
		return text;
	}

	/**
	 * Streams the reply, yielding text deltas as they arrive.
	 *
	 * Uses `fetch` with `stream: true` and parses Anthropic's
	 * `text/event-stream`. Each frame carries `data: {...}` JSON; the plugin
	 * only acts on `content_block_delta` (yields `delta.text`) and
	 * `message_stop` (ends the stream).
	 *
	 * @param signal Optional abort signal; cancelling rejects with an `AbortError`.
	 */
	async *chatStream(
		messages: ChatMessage[],
		options: ChatOptions = {},
		signal?: AbortSignal,
	): AsyncGenerator<string, void, void> {
		const payload = this.buildPayload(messages, options, true);

		const response = await fetch(`${this.baseUrl}/v1/messages`, {
			method: 'POST',
			headers: this.buildHeaders(true),
			body: JSON.stringify(payload),
			signal,
		});

		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw chatHttpError(response.status, body, 'Anthropic');
		}

		yield* readSseStream(response, parseAnthropicSseData);
	}

	/**
	 * Builds the JSON body shared by `chat()` and `chatStream()`.
	 *
	 * The system prompt (from `options.system` plus any system-role history
	 * messages) is hoisted to the top-level `system` field; the remaining
	 * user/assistant messages stay in `messages`. `numPredict` maps to the
	 * required `max_tokens` (default 2048). `think` is ignored.
	 */
	private buildPayload(
		messages: ChatMessage[],
		options: ChatOptions,
		stream: boolean,
	): Record<string, unknown> {
		const model = options.model?.trim() ?? this.defaultModel;
		if (!model) {
			throw new ChatError(
				'No model is configured for Anthropic. Set one in the plugin settings.',
			);
		}

		const { system, conversation } = this.splitSystem(messages, options.system);
		if (conversation.length === 0) {
			throw new ChatError('Cannot send an empty conversation to Anthropic.');
		}

		const payload: Record<string, unknown> = {
			model,
			max_tokens: options.numPredict ?? 2048,
			messages: conversation,
			stream,
		};

		if (system) payload.system = system;
		if (typeof options.temperature === 'number') {
			payload.temperature = options.temperature;
		}

		return payload;
	}

	/**
	 * Collects every system prompt into one string and returns the remaining
	 * user/assistant messages. Anthropic rejects system-role messages inside
	 * `messages`, so they must never leak through.
	 */
	private splitSystem(
		messages: ChatMessage[],
		system: string | undefined,
	): { system: string; conversation: ChatMessage[] } {
		const parts: string[] = [];
		const systemPrompt = system?.trim();
		if (systemPrompt) parts.push(systemPrompt);

		const conversation: ChatMessage[] = [];
		for (const message of messages) {
			if (message.role === 'system') {
				if (message.content.trim()) parts.push(message.content.trim());
			} else {
				conversation.push({ role: message.role, content: message.content });
			}
		}

		return { system: parts.join('\n\n'), conversation };
	}

	/** Joins every `text` content block from a non-streaming reply. */
	private extractText(response: AnthropicMessagesResponse): string {
		if (!Array.isArray(response.content)) return '';
		const chunks: string[] = [];
		for (const block of response.content) {
			if (block?.type === 'text' && typeof block.text === 'string') {
				chunks.push(block.text);
			}
		}
		return chunks.join('').trim();
	}

	/** Headers for JSON requests, including the required Anthropic fields. */
	private buildHeaders(json: boolean): Record<string, string> {
		const headers: Record<string, string> = {
			'x-api-key': this.apiKey,
			'anthropic-version': '2023-06-01',
		};
		if (json) headers['Content-Type'] = 'application/json';
		return headers;
	}

	/**
	 * Performs the HTTP request through `requestUrl` and converts failures
	 * into ChatErrors. `throw: false` lets Obsidian resolve for non-2xx
	 * responses so the status code and Anthropic's error text can be
	 * reported to the user.
	 */
	private async requestText(
		path: string,
		method: string,
		body?: unknown,
	): Promise<string> {
		if (!this.apiKey) {
			throw new ChatError(
				'No API key is configured for Anthropic. Add one in the plugin settings.',
			);
		}

		try {
			const response = await requestUrl({
				url: `${this.baseUrl}${path}`,
				method,
				headers: this.buildHeaders(body !== undefined),
				contentType: body === undefined ? undefined : 'application/json',
				body: body === undefined ? undefined : JSON.stringify(body),
				throw: false,
			});

			if (response.status < 200 || response.status >= 300) {
				throw chatHttpError(response.status, response.text, 'Anthropic');
			}

			return response.text;
		} catch (error) {
			if (error instanceof ChatError) throw error;

			const reason = error instanceof Error ? error.message : String(error);
			throw new ChatError(
				`Could not reach Anthropic at ${this.baseUrl}. Check your network connection and the base URL in settings. (${reason})`,
			);
		}
	}
}
