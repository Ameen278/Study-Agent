# How the plugin works

This document explains the whole plugin: what each file does, how a message
travels from the sidebar to Ollama and back, how settings are stored, and what
to check when something fails.

## What the plugin does

`study-agent` adds a chat sidebar to Obsidian. Messages are sent to the
configured AI provider — a local [Ollama](https://ollama.com/) server by
default, or a cloud API (OpenAI, Anthropic Claude, OpenRouter, Groq, Gemini,
or any OpenAI-compatible server). The reply is shown in the sidebar. See
[AiProviders.md](../guide/AiProviders.md) for the provider list and privacy details.

Current features:

- Open the chat from the ribbon bot icon or the **Open local study AI** command.
- Chat with any model installed in Ollama, or any model offered by the selected
  cloud provider.
- Stream replies token by token with live Markdown rendering; cancel mid-reply
  with the **Stop** button.
- Keep the conversation context while the sidebar stays open.
- Show loading, success, and error states in the chat.
- Choose the AI provider, base URL, and model from the plugin settings tab. The
  model list is loaded from the active provider and can be refreshed.
- Turn thinking mode on or off for Ollama models that support it — from the
  settings tab or the sidebar switch; both stay in sync.

## Requirements

- Obsidian **1.7.2** or newer.
- For local chat: Ollama installed and running (`ollama serve`) with at least
  one chat model pulled, for example:

  ```bash
  ollama pull llama3.2
  ```

- For cloud chat: an account and API key with the chosen provider.

## File map

| File                       | Responsibility                                                                 |
| -------------------------- | ------------------------------------------------------------------------------ |
| `src/main.ts`              | Plugin lifecycle: loads settings (with migration), registers view, ribbon, command. |
| `src/settings.ts`          | Settings interface, defaults, migration, and the settings tab UI.               |
| `src/ui/ChatView.ts`       | Sidebar lifecycle, message history, send/stop orchestration, switches, model line. |
| `src/ui/renderQueue.ts`    | Throttled Markdown rendering pipeline (single timer + render chain).            |
| `src/ui/copyReply.ts`      | Copy icon, selection copy, per-bubble reply text map, error notes.              |
| `src/ui/bubbles.ts`        | Message-bubble DOM helpers (append, text replace, scroll).                      |
| `src/ui/activeFileContext.ts` | Active-note context block for the system prompt.                          |
| `src/ui/systemPrompt.ts`   | Always-on study-assistant identity and system-prompt assembly.              |
| `src/ui/SkillModal.ts`     | Modal for creating and editing custom skills (name + prompt).               |
| `src/ui/skillSettings.ts`  | Custom skills section of the settings tab (add/edit/delete rows).           |
| `src/ui/chatErrors.ts`     | Abort/network error predicates and message formatting.                         |
| `src/ChatService.ts`       | Shared provider layer: types, `ChatError`, provider registry, factory, model label. |
| `src/skills.ts`            | Skill type, the three built-in skills, lookup and id helpers.               |
| `src/OllamaService.ts`     | HTTP client for Ollama: connection check, model list, chat, and streaming.      |
| `src/OpenAiService.ts`     | Client for OpenAI, OpenRouter, Groq, Gemini, and custom OpenAI-compatible servers. |
| `src/AnthropicService.ts`  | Client for Anthropic's Claude Messages API.                                     |
| `styles.css`               | Styling for the sidebar, messages, textarea, and buttons.                      |
| `docs/guide/AiProviders.md`| Provider list, setup, privacy, and protocol notes.                              |
| `docs/dev/ChatViewStructure.md`| Sidebar module layout and the `Provider · model` line.                     |
| `docs/dev/OllamaService.md`| Detailed reference for the Ollama client.                                      |
| `docs/dev/Settings.md`     | Detailed reference for the settings file.                                      |
| `docs/guide/Skills.md`     | Built-in and custom skills: how to create and use them.                        |
| `docs/dev/MarkdownRendering.md`| How replies are rendered as Markdown.                                     |
| `docs/dev/Streaming.md`    | How streaming, stopping, and the fallback work.                                |
| `docs/dev/ThinkingSwitchAndCopyIcon.md` | Sidebar thinking switch, copy icon, and selection copy.      |
| `docs/dev/CopyFixAndThinkingIndicator.md` | Copy-icon wipe bug fix, partial copy, `Thinking...` placeholder. |
| `docs/dev/HowItWorks.md`   | This end-to-end explanation.                                                   |

## Installation and build

For development:

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```

The build writes `main.js`. Obsidian loads `main.js`, `manifest.json`, and
`styles.css` from:

```text
<Vault>/.obsidian/plugins/study-agent/
```

After building, reload Obsidian or disable/re-enable the plugin. If the plugin
does not appear, check that `main.js` and `manifest.json` are at the top level of
the plugin folder.

## Using the plugin

1. Start Ollama (for the default local provider):

   ```bash
   ollama serve
   ```

2. In Obsidian, open **Settings → Community plugins** and enable
   **Study Agent**.
3. Open the plugin settings and set:
   - **AI provider** — **Ollama (local)** by default; pick a cloud provider to
     use an API instead.
   - **Base URL** — usually `http://localhost:11434` for Ollama.
   - **API key** — for cloud providers.
   - **Model** — pick one from the dropdown. Click **Refresh** after pulling a
     new model or changing the URL.
   - **Enable thinking** (Ollama only) — leave off for direct answers.
4. Open the sidebar with the bot ribbon icon or the **Open local study AI**
   command.
5. Type a message and press **Enter** to send, or **Shift+Enter** for a new line.
6. While waiting, the input is disabled and the reply streams in token by token.
   The Send button becomes **Stop**; clicking it cancels the reply and keeps any
   text already received.

## Startup flow

When the plugin loads, `ObsidianAgentPlugin.onload()` in `src/main.ts` does the
following:

1. `loadSettings()` runs `migrateSettings()`, which merges saved data with
   defaults and adopts the legacy `ollamaBaseUrl`/`ollamaModel` fields into the
   new per-provider record.
2. Registers `ObsidianAgentSettingTab`, so the settings are visible.
3. Registers `ChatView` under the view type `local-study-ai-chat`.
4. Adds the bot ribbon icon.
5. Adds the **Open local study AI** command.

Both the ribbon icon and the command call `activateChatView()`:

1. Look for an existing chat leaf with `getLeavesOfType(VIEW_TYPE_CHAT)`.
2. If none exists, create a right-sidebar leaf with `getRightLeaf(false)`.
3. Put the chat view into that leaf with `setViewState`.
4. Reveal the leaf so the user sees it.

If the view already exists, it is simply revealed. No duplicate chat view is
created.

## Opening the sidebar

`ChatView.onOpen()` builds the DOM from scratch:

- The heading **Local study AI**.
- A `local-study-ai-messages` container with `aria-live="polite"`, so screen
  readers announce new replies.
- A form with a multiline textarea, a `local-study-ai-model-info` line showing
  the active **`Provider · model`** (for example `Ollama · qwen3.5`), a switch
  row (`local-study-ai-toggles`) containing the **Use Active File as Context**
  and **Enable thinking** switches plus the **Skill** dropdown
  (`local-study-ai-skill-select`: None, Study help, Revision, Summarize, and
  any custom skills), and a **Send** button. The thinking switch
  is hidden unless the Ollama provider is active (other providers ignore the
  `think` option).
- A submit listener and a keydown listener registered with `registerDomEvent`,
  so Obsidian cleans them up with the view.
- Selection tracking started on the copy controller (`copyController.activate`)
  that reveals the copy icon while text inside a reply is selected.
- A settings listener (`registerSettingsListener`) that keeps the thinking
  switch current, its visibility up to date, refreshes the skill dropdown when
  custom skills change, and refreshes the model line when
  settings change elsewhere; unsubscribed in `onClose()`.

The view also stores references to the messages container, textarea, and button
in fields. `sendMessage()` needs those references to update the UI later. The
rendering pipeline (`RenderQueue`) and the copy controller
(`CopyReplyController`) are created once in the constructor — see
[ChatViewStructure.md](ChatViewStructure.md) for the module layout.

`this.history = []` runs in `onOpen()`, so a reopened view starts a fresh
conversation that matches the empty message list.

## What happens when you send a message

```text
User presses Enter
        |
        v
ChatView.sendMessage()
        |
        |-- Ignore if input is empty; if already sending, treat as Stop (abort)
        |-- Disable input, relabel button to "Stop"
        |-- Add user message to the DOM
        |-- Add { role: "user", content: prompt } to this.history
        |-- Assistant bubble starts as a pulsing "Thinking..." placeholder
        |
        v
createChatService(settings)   // Ollama / OpenAI / Claude / ... client
        |
        v
for await (delta of service.chatStream(history, options, signal))
        |
        |-- Ollama: POST {baseUrl}/api/chat with stream: true (NDJSON via fetch)
        |-- OpenAI-compatible: POST {base}/chat/completions, SSE data: frames
        |-- Anthropic: POST {base}/v1/messages, SSE content_block_delta events
        |-- Each chunk yields a content delta
        |-- renderQueue.schedule() re-renders the content wrapper
        |   (debounced ~250ms; first render drops "Thinking..." and
        |    creates the copy icon, which then survives all re-renders)
        |
        v  (stream ends or is aborted)
finishPartial() → renderQueue.finish(): cancel pending timer → final render
        → push history
        |
        |-- Raw Markdown stays in history for later turns
        |-- Re-enable input, relabel button back to "Send", refocus textarea
```

If `chatStream()` fails with a `TypeError` before any token arrives (streaming
blocked by CORS), the view automatically falls back to `service.chat()`, which
uses `requestUrl` and returns the full reply at once. The user sees the same
result, just not streamed.

### Why the history is sent every time

Ollama is stateless. It does not remember previous requests, so the plugin sends
the full conversation in `this.history` on every call. That is what allows
follow-up questions such as "give me two examples" to refer to the previous
answer.

The history is in memory only. It is cleared when the view reopens and when the
plugin unloads. Nothing is written to `data.json`.

### The request body

The exact payload sent to `POST /api/chat` looks like this:

```json
{
	"model": "llama3.2",
	"messages": [
		{ "role": "user", "content": "What is a noun?" },
		{ "role": "assistant", "content": "A noun is a person, place, thing, or idea." },
		{ "role": "user", "content": "Give me two examples." }
	],
	"stream": true,
	"think": false
}
```

`ChatView` sets `think` from settings and always sets `system`: the
built-in study-assistant identity, the skill selected in the chat's skill
dropdown (see `src/skills.ts`), the optional **Custom instructions**, and the
active-note context (assembly order in `src/ui/systemPrompt.ts`).
`OllamaService` also
supports optional `temperature` and `numPredict` values, which `ChatView`
does not set. See `docs/dev/OllamaService.md` for the full API.

### Why `fetch` is used for streaming (and `requestUrl` as fallback)

Streaming requires reading the response body incrementally, which Obsidian's
`requestUrl` cannot do — it resolves with the complete body only. The plugin
therefore uses the browser `fetch` API with a `ReadableStream` for
`chatStream()`.

The catch is CORS: `fetch` is subject to the browser's same-origin rules, while
`requestUrl` is not. Ollama handles this by returning
`Access-Control-Allow-Origin: app://obsidian.md` on its API responses, so
`fetch` from Obsidian works without a proxy.

If streaming is blocked (older Ollama, a proxy stripping CORS headers, etc.),
`fetch` rejects with a `TypeError` before any token arrives. `ChatView` detects
this and falls back to `chat()`, which still uses `requestUrl` and works
regardless of CORS. See `docs/dev/Streaming.md` for the full picture.

## Settings and persistence

Settings are defined in `src/settings.ts`:

```ts
export interface ObsidianAgentSettings {
	provider: ProviderId; // 'ollama' | 'openai' | ... | 'custom'
	providers: Record<ProviderId, ProviderConfig>; // { baseUrl, apiKey, model }
	ollamaThink: boolean;
}
```

`migrateSettings()` fills missing fields from the defaults and adopts the
legacy `ollamaBaseUrl`/`ollamaModel` values into `providers.ollama`.
`saveSettings()` writes the whole object to the plugin's `data.json`.

The settings tab saves on every change:

- The **AI provider** dropdown re-renders the tab for the selected provider.
- The **Base URL** text field is bound to the active provider's config.
- The **API key** field (cloud/custom providers) is masked and stored in plain
  text in `data.json`.
- The model dropdown is filled from the active provider's `listModels()`.
  **Refresh** reloads the list, and a saved model that is not listed is kept
  visible as `name (not listed)`.
- The thinking toggle (Ollama only) sends `"think": false` when off, so
  thinking models return an answer instead of filling the reply with
  reasoning. The sidebar's **Enable thinking** switch writes the same value;
  `saveSettings()` notifies registered listeners so both controls always show
  the current state.

`ChatView` creates a new provider client for each message via
`createChatService(this.plugin.settings)`, so changing the provider, URL, key,
model, or thinking mode takes effect on the next message without reopening the
sidebar.

## Error handling

Every provider client throws `ChatError` (from `src/ChatService.ts`) for:

- The server not running or the URL being wrong.
- A non-2xx HTTP response, such as `404 model not found` or `401` with a
  targeted "rejected the API key" message.
- Invalid JSON returned while streaming.
- An empty generated reply.

`ChatView` catches the error, shows `error.message` in the assistant bubble, and
removes the failed user turn from `this.history` so it is not sent again on the
next attempt. The failed prompt remains visible in the chat for reference.

When a stream fails **after** some tokens have already arrived, the partial
reply is kept (rendered with a copy button and stored in history) and a small
red `.local-study-ai-error` note is appended under the bubble with the error
message.

Common messages and what they mean:

| Error message                                 | Likely cause                                              |
| --------------------------------------------- | --------------------------------------------------------- |
| Could not reach Ollama at ...                 | Ollama is stopped, or the URL/port is wrong.               |
| Could not reach <provider> at ...             | Network problem or wrong base URL for a cloud provider.    |
| Ollama request failed (404): model not found  | The configured model is not pulled. Run `ollama list`.     |
| <provider> rejected the API key (HTTP 401)    | Wrong or missing API key in the plugin settings.           |
| The AI returned an empty response             | The model does not support chat or generated nothing.      |
| No model is configured for <provider>         | The model field was cleared and did not fall back.         |

## Privacy and data flow

- **Ollama (default):** messages go only to the configured Ollama URL; by
  default that URL is `localhost`, so data stays on the machine.
- **Cloud providers:** messages (and active-file context when enabled) are sent
  to the provider's servers. Ollama remains the default, so nothing leaves the
  machine unless the user opts in.
- **API keys** are stored in plain text in the plugin's `data.json`.
- The plugin does not send telemetry or analytics.
- Chat history is not saved; it exists only in memory while the view is open.
- Settings (provider, URL, key, model, thinking mode) are stored in the
  plugin's `data.json`.

## Limitations

- **Cancellation only works while streaming:** the **Stop** button and
  `onClose()` abort `chatStream()` via an `AbortSignal`. The non-streaming
  `chat()` fallback (`requestUrl`) cannot be cancelled once started.
- **No timeout:** a hung server on the fallback path leaves the UI in the
  sending state until the request fails.
- **No persistence:** closing/reopening the view clears the conversation.
- **One conversation:** reopening reuses the existing view and starts fresh.
- **Fixed identity prompt:** the built-in study-assistant prompt is not
  editable; settings only expose the optional **Custom instructions** field.
- **Skill selection is not persisted:** the chosen skill resets to **None**
  when the sidebar reopens.
- **Thinking mode is a global toggle:** it applies to every model and message.

## Troubleshooting

### The plugin does not load

- Run `npm run build`.
- Confirm `main.js`, `manifest.json`, and `styles.css` are in
  `.obsidian/plugins/study-agent/`.
- Check **Settings → Community plugins** for an error message.

### The sidebar does not open

- Check that the plugin is enabled.
- Look for the bot icon in the ribbon or run **Open local study AI** from the
  command palette.
- If `revealLeaf` fails, make sure Obsidian is at least 1.7.2.

### Every message fails to connect

- For Ollama: run `ollama serve` and leave it running; open
  `http://localhost:11434/api/version` in a browser; it should return JSON.
- Confirm the plugin's **Base URL** matches the server address.
- For cloud providers: check the API key and network connection.

### "model not found"

- Click **Refresh** in the plugin settings to reload the installed models.
- Pull the model with `ollama pull <model>`, then click **Refresh** again.
- Select a model from the dropdown. A name ending in `(not installed)` is not
  available on the server.

### The reply is empty

- Turn **Enable thinking** off. Some thinking models spend their token budget on
  `message.thinking` before writing `message.content`.
- Try a smaller or non-thinking model from the dropdown.

### The first reply is slow

The first request may need to load the model into memory. Later requests are
usually faster. This is normal for local models.

### Replies are cut off

The default is no `num_predict` limit, so Ollama uses the model default. If a
reply stops early, increase `numPredict` when calling `OllamaService.chat()`
directly.

## Development

Useful commands:

```bash
npm run dev      # rebuild on change
npm run build    # type-check and production bundle
npm run lint     # ESLint with Obsidian rules
```

Known lint warning: the settings tab does not use Obsidian 1.13's declarative
settings API, so its fields do not appear in Obsidian's settings search. Using
that API would require raising `minAppVersion` to `1.13.0`.

## Next steps

Possible improvements:

- Persist conversations per note or per vault.
- Add sampling options (temperature, max tokens) to settings.
- Show model details such as size and parameter count in the dropdown.
- Add a **Test connection** button using `checkConnection()`.
- Add request timeouts for the non-streaming fallback path.
