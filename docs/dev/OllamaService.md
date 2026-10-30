# OllamaService

`src/OllamaService.ts` is a small, settings-independent client for a local
[Ollama](https://ollama.com/) server. It implements the shared `ChatService`
interface from `src/ChatService.ts` and gives the plugin these operations:

| Method                       | Ollama endpoint      | Purpose                                          |
| ---------------------------- | -------------------- | ------------------------------------------------ |
| `checkConnection()`          | `GET /api/version`   | Detect whether Ollama is running.                |
| `listModels()`               | `GET /api/tags`      | List the installed model names (`string[]`).     |
| `listModelDetails()`         | `GET /api/tags`      | List the full model info objects.                |
| `chat(messages, opts)`       | `POST /api/chat`     | Send a conversation and get the full reply text. |
| `chatStream(messages, opts)` | `POST /api/chat`     | Stream the reply token by token (async generator). |

The class is created by `createChatService()` in `ChatService.ts` when the
active provider is Ollama; you can also construct it directly with a base URL
and a default model. This keeps it easy to reuse from the chat view, the
settings tab, or a future test. Errors are the shared `ChatError` (re-exported
from this file under the legacy name `OllamaError`).

## Why two request paths exist

Ollama normally listens on `http://localhost:11434`, which is a different origin
from the Obsidian app. A browser `fetch` call is subject to CORS rules and can
fail even though Ollama is running.

Obsidian exposes `requestUrl`, which performs the request outside the browser's
CORS restrictions. `OllamaService.chat()` uses it, so local Ollama works on
desktop without extra proxy configuration. The trade-off is that `requestUrl`
returns the complete response body — it cannot stream.

Token-by-token output therefore uses the browser `fetch` API with a
`ReadableStream` in `chatStream()`. Ollama returns
`Access-Control-Allow-Origin: app://obsidian.md` by default, so `fetch` works
from Obsidian. If streaming is blocked, `fetch` rejects with a `TypeError`
before any token arrives, and the caller can fall back to `chat()`.

| Method                   | Transport             | CORS-safe?                    | Cancellable?               |
| ------------------------ | --------------------- | ----------------------------- | -------------------------- |
| `chat()`                 | `requestUrl`          | Yes (bypasses CORS)           | No                         |
| `chatStream()`           | `fetch` + stream      | Yes, if Ollama allows origin  | Yes, via `AbortSignal`     |

## Prerequisites

1. Install and start Ollama.
2. Pull at least one chat-capable model, for example:

   ```bash
   ollama pull llama3.2
   ```

3. Confirm the server responds:

   ```bash
   curl http://localhost:11434/api/version
   ```

## Creating the service

```ts
import { OllamaService } from "./OllamaService";

const ollama = new OllamaService(
	"http://localhost:11434", // base URL
	"llama3.2", // default model
);
```

The constructor normalizes the URL:

- `"localhost:11434"` becomes `"http://localhost:11434"`.
- Trailing slashes are removed.
- An empty string falls back to `"http://localhost:11434"`.

The model name is trimmed and stored as the default.

You can change both values later without recreating the service:

```ts
ollama.setBaseUrl("http://192.168.1.20:11434");
ollama.setDefaultModel("mistral");
```

## Checking the connection

```ts
const online = await ollama.checkConnection();

if (!online) {
	new Notice("Ollama is not reachable. Start Ollama and try again.");
}
```

`checkConnection()` never throws: it returns `true` for any successful
`/api/version` response and `false` for connection errors. This makes it safe to
call while rendering UI.

## Listing installed models

```ts
const names = await ollama.listModels(); // string[] of model names

// Example: fill a dropdown in the settings tab.
for (const name of names) {
	console.log(name);
}
```

`listModels()` satisfies the shared `ChatService` contract and returns just
the model names. For the full info (`name`, `modified_at`, `size`, `digest`,
and optional `details` — format, family, parameter size, quantization level),
call `listModelDetails()` instead. If Ollama returns no `models` field, both
methods return an empty array.

`listModels()` powers the **Model** dropdown in the settings tab. The
dropdown's **Refresh** button calls it again after the URL changes or a model is
pulled.

## Thinking models

Some models (for example `qwen3.5`) can reason before answering. By default
Ollama may put that reasoning in `message.thinking` and leave `message.content`
empty until the reasoning finishes or the token budget runs out.

Pass `think: false` to get the answer directly:

```ts
const reply = await ollama.chat(messages, {
	think: false,
});
```

The plugin exposes this as the **Enable thinking** toggle in settings. When the
toggle is off, `ChatView` sends `"think": false`; when it is on, the model may
reason first and take longer to reply.

## Sending a chat message

```ts
const reply = await ollama.chat([
	{ role: "user", content: "Explain photosynthesis in one paragraph." },
]);

console.log(reply);
```

`chat()` returns the assistant's reply as a trimmed string.

### Conversation history

Ollama is stateless: it only knows what you send in `messages`. To keep context,
send the previous turns along with the new message. The order is oldest first:

```ts
const conversation = [
	{ role: "user", content: "What is a noun?" },
	{ role: "assistant", content: "A noun is a person, place, thing, or idea." },
	{ role: "user", content: "Give me two examples." },
] as const;

const reply = await ollama.chat([...conversation]);
```

The `system` role sets the assistant's behaviour. You can either include it in
`messages` yourself, or pass it once via options:

```ts
const reply = await ollama.chat(messages, {
	system: "You are a concise study assistant. Answer in short paragraphs.",
});
```

When `system` is provided, `chat()` prepends it as the first message.

### Per-request options

```ts
const reply = await ollama.chat(messages, {
	model: "mistral", // overrides the service default
	system: "You are a patient tutor.",
	temperature: 0.3, // lower = more focused, higher = more creative
	numPredict: 512, // maximum number of generated tokens
	think: false, // skip reasoning for thinking models
});
```

Only options you set are sent to Ollama. Internally, `temperature` and
`numPredict` become `options.temperature` and `options.num_predict`, while
`think` stays at the top level of the request body:

```json
{
	"model": "mistral",
	"messages": [{ "role": "user", "content": "Hello" }],
	"stream": true,
	"think": false,
	"options": { "temperature": 0.3, "num_predict": 512 }
}
```

## Streaming a chat message

```ts
const controller = new AbortController();

try {
	for await (const delta of ollama.chatStream(messages, options, controller.signal)) {
		partial += delta;
		renderPartial(partial);
	}
} catch (error) {
	if (error instanceof DOMException && error.name === "AbortError") {
		// User pressed Stop; keep the partial text.
	} else if (error instanceof ChatError) {
		new Notice(error.message);
	}
}
```

`chatStream()` is an async generator that yields the assistant's reply in
pieces. Unlike `chat()`, it uses the browser `fetch` API (see above) and
Ollama's newline-delimited JSON streaming format:

```json
{ "message": { "role": "assistant", "content": "Hel" }, "done": false }
{ "message": { "role": "assistant", "content": "lo" }, "done": false }
{ "message": { "role": "assistant", "content": "" }, "done": true }
```

Key behaviors:

- Accepts the same `messages` and `OllamaChatOptions` as `chat()`.
- Accepts an optional `AbortSignal`; cancelling it rejects with an `AbortError`.
- Buffers partial network chunks, so a JSON line split across TCP packets is
  reassembled before parsing.
- Ollama error bodies (`{ "error": "..." }`) become `OllamaError`s.
- Ends normally when the `done: true` chunk arrives.

`chat()` and `chatStream()` share the same `buildChatPayload()` and
`parseStreamChunk()` internals, so options and validation behave identically.

## Error handling

All failures are reported as `ChatError` (shared across every provider):

```ts
import { ChatError } from "./ChatService";

try {
	const reply = await ollama.chat(messages);
	renderReply(reply);
} catch (error) {
	if (error instanceof ChatError) {
		new Notice(error.message);
	} else {
		new Notice("Unexpected error while contacting Ollama.");
	}
}
```

`ChatError` has two useful properties:

- `message` — a human-readable explanation suitable for a `Notice`.
- `status` — the HTTP status code when Ollama responded, or `undefined` when
  the server could not be reached at all.

Typical errors include:

- No model configured.
- Empty conversation passed to `chat()`.
- Ollama not running or wrong URL.
- HTTP errors such as `404 model not found`.
- Invalid JSON from a proxy or misconfigured URL.
- An empty generated reply.

## Internal request flow

Every method eventually calls the private `request<T>()` helper:

1. Build the full URL as `baseUrl + path`.
2. Call `requestUrl` with `throw: false` so non-2xx responses are inspected
   instead of immediately throwing.
3. On a non-2xx status, extract Ollama's `{ "error": "..." }` message and throw
   a `ChatError` with the status code.
4. Parse the response body with `JSON.parse`; invalid JSON becomes a
   `ChatError`.
5. Any remaining exception (for example a refused connection) is wrapped in a
   `ChatError` that tells the user to check that Ollama is running and the URL
   is correct.

## Integrating with the plugin

`ChatView` builds the right client for the active provider per request:

```ts
// ChatView.ts
import { createChatService } from "../ChatService";

const service = createChatService(this.plugin.settings);
```

When the active provider is Ollama, the factory returns an `OllamaService`
constructed from `settings.providers.ollama.baseUrl` and `.model`:

```ts
const controller = new AbortController();
let partial = "";

try {
	for await (const delta of service.chatStream(
		this.history,
		{ think: this.plugin.settings.ollamaThink },
		controller.signal,
	)) {
		partial += delta;
		this.renderQueue.schedule(replyEl, partial);
	}
	this.history.push({ role: "assistant", content: partial });
} catch (error) {
	if (partial === "" && error instanceof TypeError) {
		// Streaming blocked; fall back to the non-streaming path.
		const reply = await service.chat(this.history, {
			think: this.plugin.settings.ollamaThink,
		});
		this.history.push({ role: "assistant", content: reply });
	} else {
		const message =
			error instanceof ChatError
				? error.message
				: "Unexpected error while contacting the AI provider.";
		replyEl.setText(message);
	}
}
```

While the request is in flight, `ChatView` disables the input, relabels the
button to **Stop**, and streams partial Markdown into the bubble. See
`docs/dev/Streaming.md` for the throttling, abort, and fallback details.

## Limitations and next steps

- **`chat()` has no timeout or cancellation:** `requestUrl` exposes neither.
  Use `chatStream()` with an `AbortSignal` when you need to cancel.
- **`chatStream()` depends on CORS:** Ollama allows `app://obsidian.md` by
  default; a custom proxy must pass the header through or the caller must fall
  back to `chat()`.
- **No retries:** connection failures are surfaced to the caller immediately.
- **No persistence:** the service does not store conversations; the caller is
  responsible for keeping message history.
