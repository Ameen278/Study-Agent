# study-agent

Chat with a local [Ollama](https://ollama.com/) model — or a cloud AI API
(OpenAI, Anthropic Claude, OpenRouter, Groq, Gemini, or any OpenAI-compatible
server) — inside Obsidian. The plugin adds a sidebar where you can ask
questions and keep a conversation going; with the default Ollama provider
nothing leaves your machine.

This README is the full guide: install, setup, and how to use every feature.
Deeper how-to topics live in [docs/guide/](docs/guide/); the code is
explained in [docs/dev/](docs/dev/).

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Setup](#setup)
- [Usage](#usage)
- [Settings](#settings)
- [Troubleshooting](#troubleshooting)
- [How the agent works](#how-the-agent-works)
- [Privacy](#privacy)
- [Limitations](#limitations)
- [Documentation](#documentation)
- [Development](#development)
- [License](#license)

## Features

- Chat sidebar opened from the ribbon or the command palette.
- **Multiple providers**: Ollama (local, default), OpenAI, Anthropic Claude,
  OpenRouter, Groq, Gemini, and custom OpenAI-compatible servers, each with
  its own saved base URL, API key, and model.
- **Live `Provider · model` line** under the message input, so you always know
  which model will answer the next message — updates instantly when you
  change settings.
- **Streaming replies**: the answer appears token by token with live Markdown.
- **Stop** button to cancel a reply mid-stream; partial text is kept.
- **Enable thinking** switch in the sidebar (Ollama only), kept in sync with
  the setting in the settings tab.
- **Use Active File as Context** switch to ground answers in the active note.
- **Always-on study-assistant prompt** — the model knows it is a study
  assistant in your Obsidian vault; extend it with **Custom instructions** in
  settings.
- **Skills** — focus the assistant with the **Skill** dropdown: built-in
  **Study help**, **Revision**, and **Summarize**, plus custom skills you
  create yourself (see [docs/guide/Skills.md](docs/guide/Skills.md)).
- Model picker that lists the models each provider offers, with a **Refresh**
  button to reload the list.
- Conversation context kept while the sidebar is open.
- Replies rendered as Markdown: headings, lists, tables, links, and code blocks.
- Copy any reply with the hover clipboard icon — even while it is still
  streaming. Copy only a selected part, or the whole reply's raw Markdown, with
  one click.
- `Thinking...` placeholder with a soft pulse until the first token arrives.
- Loading and error states shown directly in the chat.
- Local-only by default: requests go to the Ollama URL you configure; cloud
  providers are opt-in.

## Requirements

- Obsidian **1.7.2** or newer.
- For local chat: [Ollama](https://ollama.com/download) installed and running,
  with at least one chat model pulled, for example:

  ```bash
  ollama pull qwen2.5-coder:1.5b
  ```

- For cloud chat: an account and API key with the provider of your choice.

## Install

This plugin is not in the community catalog yet. Install it manually:

1. Build the plugin (see [Development](#development)) or download a release.
2. Copy `main.js`, `manifest.json`, and `styles.css` into:

   ```text
   <Vault>/.obsidian/plugins/study-agent/
   ```

3. Reload Obsidian.
4. Open **Settings → Community plugins** and enable **Study Agent**.

## Setup

### Ollama (default, local)

1. Start Ollama:

   ```bash
   ollama serve
   ```

2. Open **Settings → Community plugins → Study Agent**.
3. Keep **AI provider** on **Ollama (local)**.
4. Set **Base URL** to your server address, usually
   `http://localhost:11434`.
5. Click **Refresh** and select a model from the **Model** dropdown.
6. Leave **Enable thinking** off for faster, direct answers. Turn it on if you
   want thinking models to reason before replying.

If a saved model is not installed, the dropdown shows it as
`name (not listed)`. Pick another model or pull it with
`ollama pull <model>`, then click **Refresh**.

### Cloud providers (OpenAI, Claude, OpenRouter, Groq, Gemini)

1. Open **Settings → Community plugins → Study Agent**.
2. Pick the provider from **AI provider**.
3. Paste your **API key**.
4. Click **Refresh** and select a model.

**Custom (OpenAI-compatible)** works the same way but also asks for a **Base
URL** (for example `http://localhost:1234/v1` for LM Studio). See
[docs/guide/AiProviders.md](docs/guide/AiProviders.md) for details, privacy
notes, and technical specifics.

## Usage

### Chat basics

- Open the sidebar with the bot ribbon icon or the **Open local study AI**
  command.
- Check the **`Provider · model`** line under the input — it shows what the
  next message will use (for example `Gemini · gemini-2.5-flash`).
- Type a message and press **Enter** to send; **Shift+Enter** adds a new line.
- While the model is working, the input is disabled and the reply area shows a
  pulsing `Thinking...` until the first token; the reply then streams in token
  by token. The Send button becomes **Stop**; clicking it cancels the reply and
  keeps any text already received.
- If streaming is unavailable (CORS), the plugin falls back to a normal
  non-streaming request automatically.
- The conversation is kept in memory until the sidebar is reopened or the
  plugin is unloaded.

### Ground answers in the open note

Turn on **Use Active File as Context** (the switch under the input) and keep a
Markdown note open. Its beginning — up to 20 000 characters — is attached to
every request as reference material, and the assistant treats it as the
primary source when answering questions about that note.

### Letting models think

**Enable thinking** (Ollama only) lets thinking models reason before
answering: slower, but often better for hard problems. The switch is hidden
for other providers and stays in sync with the setting in the settings tab.

### Switch modes with skills

Pick a mode with the **Skill** dropdown — **Study help**, **Revision**,
**Summarize**, or one you created. The skill applies to every message until
you change it or select **None**, and resets when the sidebar reopens. The
full walkthrough, including creating your own skills, is in
[docs/guide/Skills.md](docs/guide/Skills.md).

### Add your own instructions

Open **Settings → Community plugins → Study Agent** and type into **Custom
instructions**. The text is appended to every request after the built-in
study-assistant prompt, so preferences like "always answer in bullets" apply
everywhere. It is sent to your AI provider with your messages.

### Copy replies

Hover a reply to reveal the copy icon: click it to copy the reply's raw
Markdown (the partial text while streaming), or select part of a reply first
to copy just that part.

## Settings

| Setting        | Default                  | Description                                                       |
| -------------- | ------------------------ | ----------------------------------------------------------------- |
| AI provider    | Ollama (local)           | Which backend to chat with.                                       |
| Base URL       | per provider             | Server address for the selected provider.                         |
| API key        | empty                    | Key for cloud providers (stored in plain text; see Privacy).      |
| Model          | `llama3.2` (Ollama)      | Model selected from the provider's list.                          |
| Enable thinking| Off                      | Lets Ollama thinking models reason before answering.              |
| Custom instructions | empty             | Extra instructions appended to every request's prompt (sent to your AI provider). |
| Custom skills  | none                   | Your own skills in the chat's **Skill** dropdown (built-ins are included). |

The stored format, defaults, and migration rules are explained in
[docs/dev/Settings.md](docs/dev/Settings.md).

## Troubleshooting

- **The plugin does not appear or does not load** — run `npm run build` and
  confirm `main.js`, `manifest.json`, and `styles.css` are in
  `<Vault>/.obsidian/plugins/study-agent/`, reload Obsidian, and check
  **Settings → Community plugins** for an error message.
- **The Model list is empty or Refresh fails** — make sure the server is
  running (`ollama serve` for local setups) and the API key and Base URL are
  correct, then select **Refresh**. A saved model that disappeared upstream
  shows as `name (not listed)`.
- **"Rejected the API key" or HTTP 401 from a cloud provider** — re-check the
  key. For Gemini, Google now issues new `AQ.` keys and older keys may be
  blocked; create a fresh key in Google AI Studio and paste it again. Details
  in [docs/guide/AiProviders.md](docs/guide/AiProviders.md).
- **The reply arrives all at once instead of streaming** — streaming was
  blocked (usually CORS on custom servers); the plugin already retried over
  the non-streaming path. The result is the same, but that path cannot be
  cancelled once started.
- **The conversation disappeared** — history lives only in memory and resets
  when the sidebar reopens (by design; see [Limitations](#limitations)).

## How the agent works

Every message is answered under an always-on study-assistant prompt — the
model knows it is working inside your Obsidian vault — plus the selected
skill, your custom instructions, and the open note when the context switch is
on. The request goes to your chosen provider, and the reply streams back
token by token with live Markdown.

- User-level walkthrough of that flow (sidebar controls, what is sent where):
  [docs/guide/HowTheAgentWorks.md](docs/guide/HowTheAgentWorks.md)
- Code-level explanation (request bodies, error handling, module layout):
  [docs/dev/HowItWorks.md](docs/dev/HowItWorks.md)

## Privacy

- **Ollama (local)**: messages are sent only to the configured Ollama URL;
  the default URL is `localhost`, so data stays on your machine.
- **Cloud providers**: messages and prompt parts (study-assistant identity,
  selected skill, custom instructions, and active-file context when enabled)
  are sent to the provider's servers (OpenAI, Anthropic, OpenRouter, Groq,
  Gemini, or your custom URL). Ollama is the default, so nothing leaves your
  machine unless you opt in. Per-provider details:
  [docs/guide/AiProviders.md](docs/guide/AiProviders.md#privacy-and-what-is-sent).
- **API keys** are stored in plain text in the vault's plugin `data.json`.
  Anyone with access to that file can read them. There is no secure key store
  in Obsidian.
- No telemetry, analytics, or vault contents are collected beyond what you
  explicitly send.
- Chat history is not written to disk and is cleared when the view reopens.

## Limitations

- Conversations are not saved.
- The non-streaming fallback path (`requestUrl`) cannot be cancelled; the
  streaming path is cancellable via **Stop**.
- Thinking mode applies to every Ollama model and message; it is ignored by
  cloud providers (Claude's extended thinking is not wired up).
- The built-in study-assistant prompt is fixed; only **Custom instructions**
  are user-editable. Sampling options (temperature, max tokens) are not
  exposed yet.
- The selected skill is view state: it resets to **None** when the sidebar
  reopens.

## Documentation

### How to use (guides)

- [How the agent works](docs/guide/HowTheAgentWorks.md) — what happens when
  you send a message, sidebar controls, what is sent where.
- [Skills — how to use them](docs/guide/Skills.md) — built-in and custom
  skills, with examples.
- [AI providers](docs/guide/AiProviders.md) — setup per provider, privacy,
  protocol notes.

### Code explained (developer docs)

- [End-to-end flow](docs/dev/HowItWorks.md) — request bodies, error handling,
  troubleshooting.
- [ChatView structure and model line](docs/dev/ChatViewStructure.md) — sidebar
  modules, system prompt assembly, skill dropdown.
- [Streaming](docs/dev/Streaming.md) — streaming, stopping, and the
  non-streaming fallback.
- [OllamaService reference](docs/dev/OllamaService.md)
- [Settings reference](docs/dev/Settings.md) — stored shape, migration,
  settings-tab UI.
- [Markdown rendering](docs/dev/MarkdownRendering.md)
- [Thinking switch and copy icon](docs/dev/ThinkingSwitchAndCopyIcon.md)
- [Copy-icon fix and Thinking indicator](docs/dev/CopyFixAndThinkingIndicator.md)
- [UI improvements](docs/dev/UiImprovements.md)

## Development

```bash
npm install
npm run dev      # rebuild on change
npm run build    # type-check and production bundle
npm run lint     # ESLint with Obsidian rules
```

The build writes `main.js` in the plugin folder.

## License

[GPL-3.0-or-later](LICENSE). You may redistribute and modify it under the
terms of the GNU General Public License v3 or (at your option) any later
version.
