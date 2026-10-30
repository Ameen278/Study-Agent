import { requestUrl } from "obsidian";
import {
	ChatError,
	type ChatMessage,
	type ChatOptions,
	type ChatRole,
	type ChatService,
} from "./ChatService";

/**
 * Legacy aliases for the shared chat types. Older code imports these names
 * from this module; they are identical to the `Chat*` types in `ChatService`.
 */
export type OllamaRole = ChatRole;
export type OllamaMessage = ChatMessage;
export type OllamaChatOptions = ChatOptions;
export { ChatError as OllamaError };

/** A model returned by Ollama's `GET /api/tags` endpoint. */
export interface OllamaModelInfo {
	name: string;
	modified_at: string;
	size: number;
	digest: string;
	details?: {
		format?: string;
		family?: string;
		families?: string[] | null;
		parameter_size?: string;
		quantization_level?: string;
	};
}

/**
 * Shape of a non-streaming reply from `POST /api/chat`.
 *
 * Ollama also returns timing information (load/eval durations), but only the
 * fields the plugin needs are described here.
 */
interface OllamaChatResponse {
	model: string;
	created_at: string;
	message: OllamaMessage;
	done: boolean;
}

/**
 * Small client for a local Ollama server.
 *
 * The service is intentionally independent of Obsidian's settings so it can be
 * created anywhere (settings tab, chat view, tests):
 *
 * ```ts
 * const ollama = new OllamaService("http://localhost:11434", "llama3.2");
 * const reply = await ollama.chat([{ role: "user", content: "Hello!" }]);
 * ```
 *
 * Requests go through Obsidian's `requestUrl` instead of the browser `fetch`.
 * `requestUrl` is not subject to CORS restrictions, which is important because
 * Ollama runs on a different origin (`http://localhost:11434`) than the app.
 *
 * Two request modes are available:
 *
 * - {@link OllamaService.chat} uses `requestUrl` and returns the whole reply at
 *   once. It is the reliable fallback.
 * - {@link OllamaService.chatStream} uses `fetch` with a `ReadableStream` so the
 *   reply can be shown token by token. Ollama allows the Obsidian origin
 *   (`app://obsidian.md`) by default; when it does not, `fetch` rejects with a
 *   `TypeError` and the caller can fall back to `chat`.
 */
export class OllamaService implements ChatService {
	private baseUrl: string;
	private defaultModel: string;

	constructor(baseUrl: string, defaultModel: string) {
		this.baseUrl = OllamaService.normalizeBaseUrl(baseUrl);
		this.defaultModel = defaultModel.trim(); // trim for remove spaces
	}

	/** The normalized server URL currently used for requests. */
	getBaseUrl(): string {
		return this.baseUrl;
	}

	/** Updates the server URL without recreating the service. */
	setBaseUrl(baseUrl: string): void {
		this.baseUrl = OllamaService.normalizeBaseUrl(baseUrl);
	}

	/** The model used when a chat request does not specify one. */
	getDefaultModel(): string {
		return this.defaultModel;
	}

	/** Updates the default model without recreating the service. */
	setDefaultModel(model: string): void {
		this.defaultModel = model.trim();
	}

	/**
	 * Checks whether an Ollama server is reachable.
	 *
	 * Uses `GET /api/version`, the cheapest Ollama endpoint. Returns `false`
	 * instead of throwing so callers can use this to enable/disable UI controls
	 * without wrapping it in `try`/`catch`.
	 */
	async checkConnection(): Promise<boolean> {
		try {
			await this.request<unknown>("/api/version");
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Lists the model names installed on the Ollama server (`GET /api/tags`).
	 *
	 * Satisfies the shared {@link ChatService} contract so the settings tab
	 * can populate a model picker for any provider. Returns an empty array if
	 * Ollama responds without a `models` field.
	 */
	async listModels(): Promise<string[]> {
		const models = await this.listModelDetails();
		return models.map((model) => model.name);
	}

	/**
	 * Lists the full model info from Ollama's `GET /api/tags` endpoint.
	 *
	 * Useful when sizes, digests, or quantization details are needed.
	 */
	async listModelDetails(): Promise<OllamaModelInfo[]> {
		const response = await this.request<{ models?: OllamaModelInfo[] }>(
			"/api/tags",
		);

		return Array.isArray(response.models) ? response.models : [];
	}

	/**
	 * Sends a chat conversation to Ollama and returns the assistant's reply.
	 *
	 * The request body follows Ollama's chat API:
	 *
	 * ```json
	 * {
	 *   "model": "llama3.2",
	 *   "messages": [{ "role": "user", "content": "Hello" }],
	 *   "stream": false,
	 *   "think": false,
	 *   "options": { "temperature": 0.7, "num_predict": 512 }
	 * }
	 * ```
	 *
	 * @param messages Full conversation history, oldest message first.
	 * @param options  Per-request overrides such as model, system prompt, and sampling options.
	 * @throws {ChatError} If no model/messages are provided, the server is unreachable, or the reply is empty.
	 */
	async chat(
		messages: OllamaMessage[],
		options: OllamaChatOptions = {},
	): Promise<string> {
		const response = await this.request<OllamaChatResponse>("/api/chat", {
			method: "POST",
			body: this.buildChatPayload(messages, options, false),
		});

		// A valid Ollama reply always contains `message.content`; guard against
		// unexpected responses (for example from a proxy) and empty generations.
		const content = response.message?.content?.trim();
		if (!content) {
			throw new ChatError(
				"Ollama returned an empty response. Check that the selected model is installed and supports chat.",
			);
		}

		return content;
	}

	/**
	 * Streams a chat conversation, yielding the assistant's reply in pieces.
	 *
	 * Unlike {@link OllamaService.chat}, this uses the browser `fetch` API
	 * because Obsidian's `requestUrl` cannot read a response incrementally.
	 * Ollama answers with newline-delimited JSON (`application/x-ndjson`), one
	 * object per token or small group of tokens:
	 *
	 * ```json
	 * { "message": { "role": "assistant", "content": "Hel" }, "done": false }
	 * { "message": { "role": "assistant", "content": "lo" }, "done": false }
	 * { "message": { "role": "assistant", "content": "" }, "done": true }
	 * ```
	 *
	 * `fetch` requires the server to allow this origin. Ollama allows
	 * `app://obsidian.md` by default; if it does not, the request rejects with
	 * a `TypeError` before any token arrives and the caller can fall back to
	 * {@link OllamaService.chat}.
	 *
	 * @param messages Full conversation history, oldest message first.
	 * @param options  Per-request overrides such as model, system prompt, and sampling options.
	 * @param signal   Optional abort signal. Cancelling it rejects with an
	 *                 `AbortError`, which callers can treat as a user stop.
	 * @yields The next piece of the reply's Markdown text.
	 * @throws {ChatError} On HTTP errors, invalid JSON, or `error` chunks from Ollama.
	 */
	async *chatStream(
		messages: OllamaMessage[],
		options: OllamaChatOptions = {},
		signal?: AbortSignal,
	): AsyncGenerator<string, void, void> {
		const payload = this.buildChatPayload(messages, options, true);

		// `fetch` is required here: `requestUrl` cannot read a response
		// incrementally, so streaming is only possible with `fetch` +
		// `ReadableStream`. Ollama allows the Obsidian origin by default.
		const response = await fetch(`${this.baseUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal,
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new ChatError(
				`Ollama request failed (${response.status}): ${OllamaService.extractErrorMessage(body)}`,
				response.status,
			);
		}

		if (!response.body) {
			throw new ChatError("Ollama returned no response body to stream.");
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				// A network chunk can split a JSON line anywhere, so keep the
				// last partial line until the rest of it arrives.
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const chunk = OllamaService.parseStreamChunk(line);
					if (chunk.content) yield chunk.content;
					if (chunk.done) return;
				}
			}

			// Flush a final line that arrived without a trailing newline.
			const remainder = decoder.decode().trim();
			if (remainder) {
				const chunk = OllamaService.parseStreamChunk(remainder);
				if (chunk.content) yield chunk.content;
			}
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * Builds the JSON body shared by `chat()` and `chatStream()`.
	 *
	 * Ollama expects sampling settings inside an `options` object and omits
	 * defaults when the object is absent, so only values the caller set are
	 * included. `think` stays at the top level of the body.
	 */
	private buildChatPayload(
		messages: OllamaMessage[],
		options: OllamaChatOptions,
		stream: boolean,
	): {
		model: string;
		messages: OllamaMessage[];
		stream: boolean;
		think?: boolean;
		options?: Record<string, number>;
	} {
		const model = options.model?.trim() ?? this.defaultModel;
		if (!model) {
			throw new ChatError(
				"No Ollama model is configured. Set one in the plugin settings.",
			);
		}

		if (messages.length === 0) {
			throw new ChatError("Cannot send an empty conversation to Ollama.");
		}

		const payload: {
			model: string;
			messages: OllamaMessage[];
			stream: boolean;
			think?: boolean;
			options?: Record<string, number>;
		} = {
			model,
			messages: this.prependSystemPrompt(messages, options.system),
			stream,
		};

		if (typeof options.think === "boolean") {
			payload.think = options.think;
		}

		const modelOptions: Record<string, number> = {};
		if (typeof options.temperature === "number") {
			modelOptions.temperature = options.temperature;
		}
		if (typeof options.numPredict === "number") {
			modelOptions.num_predict = options.numPredict;
		}
		if (Object.keys(modelOptions).length > 0) {
			payload.options = modelOptions;
		}

		return payload;
	}

	/**
	 * Parses one newline-delimited JSON line from a streaming response.
	 *
	 * Returns the content delta (empty when the line carries no new text) and
	 * whether this was Ollama's final `done` chunk. Ollama error bodies such as
	 * `{ "error": "model not found" }` become `ChatError`s.
	 */
	private static parseStreamChunk(
		line: string,
	): { content: string; done: boolean } {
		if (!line.trim()) return { content: "", done: false };

		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			throw new ChatError(
				"Ollama returned invalid JSON while streaming.",
			);
		}

		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"error" in parsed &&
			typeof parsed.error === "string"
		) {
			throw new ChatError(parsed.error);
		}

		if (typeof parsed !== "object" || parsed === null) {
			return { content: "", done: false };
		}

		const record = parsed as { message?: { content?: unknown }; done?: unknown };
		const content = record.message?.content;

		return {
			content: typeof content === "string" ? content : "",
			done: record.done === true,
		};
	}

	/** Adds the optional system prompt ahead of the conversation history. */
	private prependSystemPrompt(
		messages: OllamaMessage[],
		system: string | undefined,
	): OllamaMessage[] {
		const systemPrompt = system?.trim();
		if (!systemPrompt) return messages;

		return [{ role: "system", content: systemPrompt }, ...messages];
	}

	/**
	 * Performs the HTTP request and converts failures into `ChatError`s.
	 *
	 * `throw: false` tells Obsidian to resolve for non-2xx responses so the
	 * status code and Ollama's error message can be reported to the user.
	 */
	private async request<T>(
		path: string,
		init: { method?: string; body?: unknown } = {},
	): Promise<T> {
		const url = `${this.baseUrl}${path}`;

		try {
			const response = await requestUrl({
				url,
				method: init.method ?? "GET",
				contentType:
					init.body === undefined ? undefined : "application/json",
				body: init.body === undefined ? undefined : JSON.stringify(init.body),
				throw: false,
			});

			if (response.status < 200 || response.status >= 300) {
				throw new ChatError(
					`Ollama request failed (${response.status}): ${OllamaService.extractErrorMessage(response.text)}`,
					response.status,
				);
			}

			try {
				return JSON.parse(response.text) as T;
			} catch {
				throw new ChatError(
					`Ollama returned an invalid JSON response from ${path}.`,
					response.status,
				);
			}
		} catch (error) {
			// Preserve errors created above; wrap connection failures with a
			// message that explains what the user should check.
			if (error instanceof ChatError) throw error;

			const reason = error instanceof Error ? error.message : String(error);
			throw new ChatError(
				`Could not reach Ollama at ${this.baseUrl}. Make sure Ollama is running and the URL is correct. (${reason})`,
			);
		}
	}

	/**
	 * Normalizes user input such as `localhost:11434/` into
	 * `http://localhost:11434`.
	 */
	private static normalizeBaseUrl(url: string): string {
		const trimmed = url.trim() || "http://localhost:11434";
		const withProtocol = /^https?:\/\//i.test(trimmed)
			? trimmed
			: `http://${trimmed}`;

		return withProtocol.replace(/\/+$/, "");
	}

	/**
	 * Extracts a readable message from an Ollama error body.
	 *
	 * Ollama usually responds with `{ "error": "model not found" }`, but proxies
	 * and misconfigured URLs may return plain text or HTML, so fall back to the
	 * trimmed body (or the status text when the body is empty).
	 */
	private static extractErrorMessage(body: string): string {
		const trimmed = body.trim();
		if (!trimmed) return "No error message was returned.";

		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				"error" in parsed &&
				typeof parsed.error === "string"
			) {
				return parsed.error;
			}
		} catch {
			// Not JSON; fall through to the raw body.
		}

		return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
	}
}
