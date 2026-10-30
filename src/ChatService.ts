/**
 * Shared chat-provider layer.
 *
 * Every backend (local Ollama, OpenAI, Anthropic Claude, OpenRouter, Groq,
 * and any custom OpenAI-compatible server) implements {@link ChatService}, so
 * the settings tab and the chat view can switch providers without caring
 * about wire formats. The factory {@link createChatService} builds the right
 * client from the saved settings.
 */
import { OllamaService } from './OllamaService';
import { AnthropicService } from './AnthropicService';
import { OpenAiService } from './OpenAiService';

/** The three roles a chat message can have. */
export type ChatRole = 'system' | 'user' | 'assistant';

/** A single message in a chat conversation. */
export interface ChatMessage {
	role: ChatRole;
	content: string;
}

/** Optional parameters for a chat request. */
export interface ChatOptions {
	/** Overrides the service's default model for this request only. */
	model?: string;
	/** Prepended as a `system` message (or top-level system prompt) when provided. */
	system?: string;
	/** Controls randomness; lower values are more focused, higher values more creative. */
	temperature?: number;
	/** Maximum number of tokens the reply may use. */
	numPredict?: number;
	/**
	 * Whether thinking models may reason before replying.
	 *
	 * Only Ollama honours this; other providers ignore it.
	 */
	think?: boolean;
}

/**
 * Error thrown when a provider cannot be reached or returns an unusable
 * response. `status` is the HTTP status code when the provider responded, or
 * `undefined` when the connection itself failed.
 */
export class ChatError extends Error {
	readonly status: number | undefined;

	constructor(message: string, status?: number) {
		super(message);
		this.name = 'ChatError';
		this.status = status;
	}
}

/**
 * The contract every provider service fulfils. Method shapes match the
 * original `OllamaService` so the chat view's streaming/abort/fallback logic
 * works unchanged for every backend.
 */
export interface ChatService {
	/** Lists the model ids the provider offers (for the settings dropdown). */
	listModels(): Promise<string[]>;
	/** Sends the conversation and returns the full reply text. */
	chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
	/**
	 * Streams the reply, yielding pieces of the assistant's text.
	 *
	 * @param signal Optional abort signal; cancelling rejects with an `AbortError`.
	 */
	chatStream(
		messages: ChatMessage[],
		options?: ChatOptions,
		signal?: AbortSignal,
	): AsyncGenerator<string, void, void>;
}

/** Identifier for a configured provider. */
export type ProviderId =
	| 'ollama'
	| 'openai'
	| 'anthropic'
	| 'openrouter'
	| 'groq'
	| 'gemini'
	| 'custom';

/** Per-provider saved configuration (base URL, key, and model). */
export interface ProviderConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
}

/** Just the settings fields the factory needs (avoids an import cycle). */
export interface ProviderSettingsLike {
	provider: ProviderId;
	providers: Record<ProviderId, ProviderConfig>;
}

/** Static description of one provider entry. */
export interface ProviderPreset {
	id: ProviderId;
	label: string;
	defaultBaseUrl: string;
	/** True when the provider requires an API key to work. */
	needsKey: boolean;
	/** One-line explanation shown under the provider dropdown. */
	hint: string;
}

/** All providers the plugin ships with, in settings-dropdown order. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
	{
		id: 'ollama',
		label: 'Ollama (local)',
		defaultBaseUrl: 'http://localhost:11434',
		needsKey: false,
		hint: 'Runs on your machine. Nothing leaves your computer.',
	},
	{
		id: 'openai',
		label: 'OpenAI',
		defaultBaseUrl: 'https://api.openai.com/v1',
		needsKey: true,
		hint: 'ChatGPT models. Messages are sent to api.openai.com.',
	},
	{
		id: 'anthropic',
		label: 'Anthropic Claude',
		defaultBaseUrl: 'https://api.anthropic.com',
		needsKey: true,
		hint: 'Claude models. Messages are sent to api.anthropic.com.',
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		needsKey: true,
		hint: 'One key for many models. Messages are sent to openrouter.ai.',
	},
	{
		id: 'groq',
		label: 'Groq',
		defaultBaseUrl: 'https://api.groq.com/openai/v1',
		needsKey: true,
		hint: 'Fast open-model hosting. Messages are sent to api.groq.com.',
	},
	{
		id: 'gemini',
		label: 'Gemini',
		defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
		needsKey: true,
		hint: 'Google Gemini models via Google AI Studio. Messages are sent to generativelanguage.googleapis.com.',
	},
	{
		id: 'custom',
		label: 'Custom (OpenAI-compatible)',
		defaultBaseUrl: '',
		needsKey: false,
		hint: 'Any OpenAI-compatible server (LM Studio, vLLM, company gateway...). Set the base URL yourself.',
	},
];

/** Fresh, empty configuration for a provider. */
export function defaultProviderConfig(id: ProviderId): ProviderConfig {
	const preset = PROVIDER_PRESETS.find((p) => p.id === id);
	return {
		baseUrl: preset?.defaultBaseUrl ?? '',
		apiKey: '',
		model: id === 'ollama' ? 'llama3.2' : '',
	};
}

/** Fresh settings defaults for every provider. */
export function defaultProvidersRecord(): Record<ProviderId, ProviderConfig> {
	const record = {} as Record<ProviderId, ProviderConfig>;
	for (const preset of PROVIDER_PRESETS) {
		record[preset.id] = defaultProviderConfig(preset.id);
	}
	return record;
}

/** True when `value` is one of the known provider ids. */
export function isProviderId(value: unknown): value is ProviderId {
	return (
		typeof value === 'string' &&
		PROVIDER_PRESETS.some((preset) => preset.id === value)
	);
}

/**
 * Builds the chat client for the currently selected provider.
 *
 * Never throws for missing configuration; the individual services raise a
 * {@link ChatError} when a request is made without a model or key.
 */
export function createChatService(settings: ProviderSettingsLike): ChatService {
	const config = settings.providers[settings.provider];

	switch (settings.provider) {
		case 'ollama':
			return new OllamaService(config.baseUrl, config.model);
		case 'anthropic':
			return new AnthropicService(config.baseUrl, config.apiKey, config.model);
		default:
			// openai, openrouter, groq, gemini, and custom all speak the
			// OpenAI format (Gemini via Google's OpenAI-compatible endpoint).
			return new OpenAiService(
				config.baseUrl,
				config.apiKey,
				config.model,
				presetLabel(settings.provider),
			);
	}
}

/** Human-readable label for a provider id (falls back to the id). */
export function presetLabel(id: ProviderId): string {
	return PROVIDER_PRESETS.find((p) => p.id === id)?.label ?? id;
}

/**
 * Short label for the currently configured provider and model, e.g.
 * `Ollama · qwen3.5`. Shown under the chat input so the user always knows
 * which model will answer the next message.
 */
export function activeModelLabel(settings: ProviderSettingsLike): string {
	const label = presetLabel(settings.provider);
	const model = settings.providers[settings.provider]?.model?.trim();
	return model ? `${label} · ${model}` : `${label} · no model selected`;
}

/**
 * Normalizes a user-entered base URL: adds `http://` when the protocol is
 * missing and strips trailing slashes. An empty string stays empty so custom
 * providers can report "not configured" instead of silently hitting localhost.
 */
export function normalizeBaseUrl(url: string, fallback = ''): string {
	const trimmed = url.trim() || fallback;
	if (!trimmed) return '';
	const withProtocol = /^https?:\/\//i.test(trimmed)
		? trimmed
		: `http://${trimmed}`;
	return withProtocol.replace(/\/+$/, '');
}

/**
 * Extracts a readable message from a provider error body.
 *
 * OpenAI-style bodies use `{ "error": { "message": "..." } }` (or a plain
 * string); Anthropic uses the nested shape too; proxies may return plain text
 * or HTML, so the trimmed body is the last resort.
 */
export function extractJsonErrorMessage(body: string): string {
	const trimmed = body.trim();
	if (!trimmed) return 'No error message was returned.';

	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			'error' in parsed &&
			parsed.error !== null
		) {
			const error = parsed.error;
			if (typeof error === 'string') return error;
			if (
				typeof error === 'object' &&
				'message' in error &&
				typeof error.message === 'string'
			) {
				return error.message;
			}
		}
	} catch {
		// Not JSON; fall through to the raw body.
	}

	return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

/**
 * Builds a user-facing {@link ChatError} for a failed HTTP response.
 * 401/403 get a targeted "check your API key" message; everything else
 * includes the provider's own error text.
 */
export function chatHttpError(
	status: number,
	body: string,
	serviceLabel: string,
): ChatError {
	if (status === 401 || status === 403) {
		return new ChatError(
			`${serviceLabel} rejected the API key (HTTP ${status}). Check the key in the plugin settings.`,
			status,
		);
	}
	return new ChatError(
		`${serviceLabel} request failed (${status}): ${extractJsonErrorMessage(body)}`,
		status,
	);
}

/**
 * Reads a `text/event-stream` (SSE) response body, yielding text deltas.
 *
 * Shared by the OpenAI-compatible and Anthropic services. Handles network
 * chunks that split events anywhere by buffering complete lines; each line
 * starting with `data:` is handed to `parseData`.
 *
 * @param parseData Turns one SSE `data:` payload into a delta and a done flag.
 */
export async function* readSseStream(
	response: Response,
	parseData: (data: string) => { content: string; done: boolean },
): AsyncGenerator<string, void, void> {
	if (!response.body) {
		throw new ChatError('The provider returned no response body to stream.');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const rawLine of lines) {
				const line = rawLine.trimEnd();
				if (!line.startsWith('data:')) continue;
				const payload = line.slice(5).trim();
				if (!payload) continue;
				const parsed = parseData(payload);
				if (parsed.content) yield parsed.content;
				if (parsed.done) return;
			}
		}

		// Flush a final line that arrived without a trailing newline.
		const remainder = decoder.decode();
		for (const rawLine of remainder.split('\n')) {
			const line = rawLine.trimEnd();
			if (!line.startsWith('data:')) continue;
			const payload = line.slice(5).trim();
			if (!payload) continue;
			const parsed = parseData(payload);
			if (parsed.content) yield parsed.content;
			if (parsed.done) return;
		}
	} finally {
		reader.releaseLock();
	}
}

/**
 * Parses one OpenAI-format SSE `data:` payload.
 *
 * Deltas live at `choices[0].delta.content`; the stream ends with the literal
 * `[DONE]` marker; error objects become {@link ChatError}s.
 */
export function parseOpenAiSseData(data: string): {
	content: string;
	done: boolean;
} {
	if (data === '[DONE]') return { content: '', done: true };

	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		throw new ChatError('The provider returned invalid JSON while streaming.');
	}

	if (typeof parsed === 'object' && parsed !== null) {
		if ('error' in parsed && parsed.error) {
			throw new ChatError(extractJsonErrorMessage(JSON.stringify(parsed)));
		}

		const record = parsed as {
			choices?: Array<{ delta?: { content?: unknown } }>;
		};
		const content = record.choices?.[0]?.delta?.content;
		if (typeof content === 'string' && content) {
			return { content, done: false };
		}
	}

	return { content: '', done: false };
}

/**
 * Parses one Anthropic-format SSE `data:` payload.
 *
 * Text arrives in `content_block_delta` events as `delta.text`; the stream
 * ends with `message_stop`; `error` events become {@link ChatError}s. All
 * other event types (message_start, content_block_start, ...) are ignored.
 */
export function parseAnthropicSseData(data: string): {
	content: string;
	done: boolean;
} {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		throw new ChatError('Anthropic returned invalid JSON while streaming.');
	}

	if (typeof parsed !== 'object' || parsed === null) {
		return { content: '', done: false };
	}

	const record = parsed as {
		type?: unknown;
		delta?: { type?: unknown; text?: unknown };
		error?: { message?: unknown };
	};

	if (record.type === 'error') {
		const message =
			typeof record.error?.message === 'string'
				? record.error.message
				: 'Anthropic reported an unknown streaming error.';
		throw new ChatError(message);
	}

	if (record.type === 'message_stop') return { content: '', done: true };

	if (
		record.type === 'content_block_delta' &&
		record.delta?.type === 'text_delta' &&
		typeof record.delta.text === 'string'
	) {
		return { content: record.delta.text, done: false };
	}

	return { content: '', done: false };
}
