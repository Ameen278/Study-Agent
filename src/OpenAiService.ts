import { requestUrl } from 'obsidian';
import {
	ChatError,
	chatHttpError,
	normalizeBaseUrl,
	parseOpenAiSseData,
	readSseStream,
	type ChatMessage,
	type ChatOptions,
	type ChatService,
} from './ChatService';

/** Response shape of `POST {base}/chat/completions` (non-streaming). */
interface OpenAiChatResponse {
	choices?: Array<{ message?: { content?: unknown } }>;
}

/** Response shape of `GET {base}/models`. */
interface OpenAiModelsResponse {
	data?: Array<{ id?: unknown }>;
}

/**
 * Client for OpenAI-compatible chat APIs.
 *
 * Used for OpenAI, OpenRouter, Groq, and any custom server that speaks the
 * OpenAI `chat/completions` protocol (LM Studio, vLLM, ...). The base URL
 * must include the API prefix the server expects (usually ending in `/v1`).
 *
 * Requests use Obsidian's `requestUrl` (not subject to CORS) for the
 * non-streaming paths; streaming uses `fetch` because `requestUrl` cannot
 * read responses incrementally. Cloud providers normally allow the Obsidian
 * origin, but when a custom server rejects `fetch`, the chat view falls back
 * to the non-streaming {@link OpenAiService.chat}.
 */
export class OpenAiService implements ChatService {
	private baseUrl: string;
	private apiKey: string;
	private defaultModel: string;
	private serviceLabel: string;

	/**
	 * @param baseUrl     API root, e.g. `https://api.openai.com/v1`.
	 * @param apiKey      Bearer token; may be empty for servers that do not need one.
	 * @param defaultModel Model used when a request does not specify one.
	 * @param serviceLabel Human-readable name used in error messages.
	 */
	constructor(
		baseUrl: string,
		apiKey: string,
		defaultModel: string,
		serviceLabel: string,
	) {
		this.baseUrl = normalizeBaseUrl(baseUrl, 'https://api.openai.com/v1');
		this.apiKey = apiKey.trim();
		this.defaultModel = defaultModel.trim();
		this.serviceLabel = serviceLabel;
	}

	/**
	 * Lists the model ids available to this API key (`GET {base}/models`).
	 *
	 * Returns an empty array when the response has no usable `data` entries.
	 * 401/403 responses become targeted ChatErrors so the settings tab can
	 * show "check your API key" instead of a raw status code.
	 */
	async listModels(): Promise<string[]> {
		const body = await this.requestText('/models', 'GET');
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			throw new ChatError(
				`${this.serviceLabel} returned an invalid JSON response from /models.`,
			);
		}

		const response = parsed as OpenAiModelsResponse;
		if (!Array.isArray(response.data)) return [];

		const ids: string[] = [];
		for (const entry of response.data) {
			if (typeof entry?.id === 'string' && entry.id) ids.push(entry.id);
		}
		return ids;
	}

	/**
	 * Sends the conversation and returns the full reply text
	 * (`POST {base}/chat/completions` with `stream: false`).
	 *
	 * @throws {ChatError} When no model is configured, the request fails, or
	 *         the provider returns an empty reply.
	 */
	async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
		const payload = this.buildPayload(messages, options, false);

		const body = await this.requestText('/chat/completions', 'POST', payload);
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			throw new ChatError(
				`${this.serviceLabel} returned an invalid JSON response.`,
			);
		}

		const response = parsed as OpenAiChatResponse;
		const content = response.choices?.[0]?.message?.content;
		const text = typeof content === 'string' ? content.trim() : '';
		if (!text) {
			throw new ChatError(
				`${this.serviceLabel} returned an empty response. Check that the selected model exists and supports chat completions.`,
			);
		}
		return text;
	}

	/**
	 * Streams the reply, yielding text deltas as they arrive.
	 *
	 * Uses `fetch` with `stream: true` and parses `text/event-stream` frames.
	 * Each frame carries `data: {...}` JSON (or the literal `data: [DONE]`)
	 * with the next piece of text in `choices[0].delta.content`.
	 *
	 * @param signal Optional abort signal; cancelling rejects with an `AbortError`.
	 */
	async *chatStream(
		messages: ChatMessage[],
		options: ChatOptions = {},
		signal?: AbortSignal,
	): AsyncGenerator<string, void, void> {
		const payload = this.buildPayload(messages, options, true);

		// `fetch` is required here: `requestUrl` cannot read a response
		// incrementally, so streaming is only possible with `fetch` +
		// `ReadableStream`.
		const response = await fetch(
			`${this.baseUrl}/chat/completions`,
			{
				method: 'POST',
				headers: this.buildHeaders(true),
				body: JSON.stringify(payload),
				signal,
			},
		);

		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw chatHttpError(response.status, body, this.serviceLabel);
		}

		yield* readSseStream(response, parseOpenAiSseData);
	}

	/**
	 * Builds the JSON body shared by `chat()` and `chatStream()`.
	 *
	 * `numPredict` maps to OpenAI's `max_tokens`; the `think` option is
	 * ignored because OpenAI-format APIs have no equivalent switch.
	 */
	private buildPayload(
		messages: ChatMessage[],
		options: ChatOptions,
		stream: boolean,
	): Record<string, unknown> {
		const model = options.model?.trim() ?? this.defaultModel;
		if (!model) {
			throw new ChatError(
				`No model is configured for ${this.serviceLabel}. Set one in the plugin settings.`,
			);
		}

		if (messages.length === 0) {
			throw new ChatError(
				`Cannot send an empty conversation to ${this.serviceLabel}.`,
			);
		}

		const payload: Record<string, unknown> = {
			model,
			messages: this.normalizeMessages(messages, options.system),
			stream,
		};

		if (typeof options.temperature === 'number') {
			payload.temperature = options.temperature;
		}
		if (typeof options.numPredict === 'number') {
			payload.max_tokens = options.numPredict;
		}

		return payload;
	}

	/**
	 * Prepends the system prompt as a `system` message (the role OpenAI
	 * expects). OpenAI-format APIs accept system-role messages inside the
	 * `messages` array, unlike Anthropic's top-level `system` field.
	 */
	private normalizeMessages(
		messages: ChatMessage[],
		system: string | undefined,
	): ChatMessage[] {
		const systemPrompt = system?.trim();
		if (!systemPrompt) return messages;
		return [{ role: 'system', content: systemPrompt }, ...messages];
	}

	/** Headers for JSON requests; the Authorization header is omitted when no key is set. */
	private buildHeaders(json: boolean): Record<string, string> {
		const headers: Record<string, string> = {};
		if (json) headers['Content-Type'] = 'application/json';
		if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
		return headers;
	}

	/**
	 * Performs the HTTP request through `requestUrl` and converts failures
	 * into ChatErrors. `throw: false` lets Obsidian resolve for non-2xx
	 * responses so the status code and the provider's error text can be
	 * reported to the user.
	 */
	private async requestText(
		path: string,
		method: string,
		body?: unknown,
	): Promise<string> {
		try {
			const response = await requestUrl({
				url: `${this.baseUrl}${path}`,
				method,
				headers: this.buildHeaders(body !== undefined),
				contentType:
					body === undefined ? undefined : 'application/json',
				body: body === undefined ? undefined : JSON.stringify(body),
				throw: false,
			});

			if (response.status < 200 || response.status >= 300) {
				throw chatHttpError(response.status, response.text, this.serviceLabel);
			}

			return response.text;
		} catch (error) {
			if (error instanceof ChatError) throw error;

			const reason = error instanceof Error ? error.message : String(error);
			throw new ChatError(
				`Could not reach ${this.serviceLabel} at ${this.baseUrl}. Check your network connection and the base URL in settings. (${reason})`,
			);
		}
	}
}
