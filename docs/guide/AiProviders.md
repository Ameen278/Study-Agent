# AI providers

The plugin can chat with several AI backends. Everything goes through one
shared layer (`src/ChatService.ts`), so the sidebar behaves the same way no
matter which provider is active: streaming replies, the **Stop** button, the
copy icon, active-file context, and the automatic non-streaming fallback all
work everywhere.

## Supported providers

| Provider               | Default base URL                        | API key | Notes                                              |
| ---------------------- | --------------------------------------- | ------- | -------------------------------------------------- |
| Ollama (local)         | `http://localhost:11434`                | No      | Default. Nothing leaves your machine.              |
| OpenAI                 | `https://api.openai.com/v1`             | Yes     | ChatGPT models (`gpt-4o-mini`, ...).               |
| Anthropic Claude       | `https://api.anthropic.com`             | Yes     | Claude models (`claude-sonnet-4-...`, ...).        |
| OpenRouter             | `https://openrouter.ai/api/v1`          | Yes     | One key for many models.                           |
| Groq                   | `https://api.groq.com/openai/v1`        | Yes     | Fast open-model hosting.                           |
| Gemini                 | `https://generativelanguage.googleapis.com/v1beta/openai` | Yes | Google Gemini models via the OpenAI-compatible endpoint. |
| Custom (OpenAI-...)    | you enter it                            | Optional| LM Studio, vLLM, LiteLLM, company gateways, ...   |

## How to set up a provider

1. Open **Settings → Community plugins → Study Agent**.
2. Pick a provider from **AI provider**. The tab re-renders for that provider.
3. Check the **Base URL** — the default is pre-filled; only change it if your
   server lives elsewhere (required for **Custom**).
4. Paste your **API key** where the provider needs one.
5. Click **Refresh** next to **Model** and pick a model. Your saved model stays
   in the list even if it later disappears from the server
   (`model (not listed)`).
6. Chat as usual from the sidebar.

The **Enable thinking** switch appears only while Ollama is selected, because
only Ollama's `think` flag is wired up.

## Privacy and what is sent

- **Ollama (local)** — requests go to the URL you configure (default
  `localhost`). Data stays on your machine.
- **Cloud providers** — when you select OpenAI, Anthropic, OpenRouter, Groq,
  Gemini, or a custom server, your messages are sent to that server. This
  includes:
  - every message in the conversation so far (conversation history),
  - the built-in study-assistant identity prompt and your **Custom
    instructions** (always), plus the selected **skill's** prompt (built-in
    or custom) while a skill other than None is active,
  - the **active-file context** (the beginning of the active note, up to
    20 000 characters) when **Use Active File as Context** is on.
- **API keys** are stored in plain text in the vault's
  `.obsidian/plugins/study-agent/data.json`. Obsidian plugins have no
  secure key store; anyone with access to that file can read the key. Use a
  restricted key where possible, and never share your `data.json`.
- The plugin never sends vault contents beyond what you explicitly enable with
  the context switch. There is no telemetry or analytics.

## Technical notes

- **OpenAI-compatible** (OpenAI, OpenRouter, Groq, Gemini, Custom) —
  implemented in `src/OpenAiService.ts`. Non-streaming requests use Obsidian's
  `requestUrl`; streaming uses `fetch` with Server-Sent Events (`data: {...}`
  frames ending with `data: [DONE]`). `GET {base}/models` fills the model
  dropdown. Gemini uses Google's OpenAI-compatible endpoint
  (`/v1beta/openai`) with a Gemini API key as the Bearer token. 401/403
  responses show a "rejected the API key" message; 429 shows the provider's
  rate-limit text.
- **Anthropic** — implemented in `src/AnthropicService.ts` on the Messages
  API (`POST /v1/messages`, `anthropic-version: 2023-06-01`). The system
  prompt is sent as the top-level `system` field (Claude rejects system-role
  messages inside `messages`), and `max_tokens` is required (default 2048).
  Streaming parses `content_block_delta` events; `think` is ignored — Claude's
  extended thinking is not wired up.
- **Ollama** — `src/OllamaService.ts`, unchanged wire format (`/api/chat`,
  NDJSON streams, the `think` flag).
- Errors from any provider surface as `ChatError` and appear inline in the
  chat bubble.
