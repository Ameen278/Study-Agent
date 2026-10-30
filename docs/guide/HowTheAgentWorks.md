# How the agent works

This page explains what the study assistant actually does when you chat with
it — no code required. For step-by-step instructions see the
[README guide](../../README.md); for skills see [Skills.md](Skills.md); for
providers and privacy see [AiProviders.md](AiProviders.md).

## The idea

The agent is a chat sidebar inside Obsidian that talks to an AI model of your
choice — a local Ollama model (nothing leaves your machine) or a cloud API
(OpenAI, Claude, OpenRouter, Groq, Gemini). Whatever you pick, the plugin
presents it the same way: a conversation that knows it is helping you study
inside your vault.

Three things always shape its answers:

1. **The study-assistant identity** — every reply is generated under a
   built-in prompt that says: you are a study assistant in this Obsidian
   vault; ground answers in the notes you are given, admit what you don't
   know, answer in your language.
2. **The selected skill** — the **Skill** dropdown switches the assistant
   into a mode (Study help, Revision, Summarize, or one you wrote). Skills
   are explained in [Skills.md](Skills.md).
3. **Your custom instructions** — the optional text in settings, which is
   appended after everything else, so your own preferences always win.

## What happens when you send a message

1. **The prompt is assembled.** In order: the study-assistant identity → the
   skill you selected → your custom instructions → the active note (when
   **Use Active File as Context** is on, the beginning of the open note is
   attached as reference material).
2. **Your conversation is sent to the provider.** The whole visible
   conversation goes with it, so the model remembers what you asked earlier
   in the session. Where it is sent depends on your provider — your own
   machine for Ollama, the provider's server for cloud providers.
3. **The reply streams in.** You see tokens arrive one by one with live
   Markdown (headings, lists, tables, code). `Thinking...` shows until the
   first token lands.
4. **You stay in control.** **Stop** cancels mid-reply and keeps the text
   received so far. If streaming is blocked (CORS on some custom servers),
   the plugin automatically retries with a normal non-streaming request —
   you just see the reply arrive all at once.
5. **The model's answer is kept in the conversation** until you close or
   reload the sidebar, so follow-up questions have context.

## The sidebar controls

| Control | What it does |
| ------- | ------------ |
| Textarea | Type a message; **Enter** sends, **Shift+Enter** adds a line. |
| `Provider · model` line | Shows exactly which model the next message will use; updates live when you change settings. |
| **Use Active File as Context** | Attaches the open note to every request as reference material (Markdown files, up to 20 000 characters). |
| **Enable thinking** | Lets Ollama thinking models reason before answering (Ollama only; hidden for other providers). |
| **Skill** dropdown | Activates a skill's instructions for every message until you change it or select **None**; resets when the sidebar reopens. |
| **Send** / **Stop** | Sends the message, or cancels the reply while it streams. |
| Copy icon (hover a reply) | Copies the reply's raw Markdown — click while streaming to copy the partial text, or select part of a reply first to copy just that part. |

## What is sent where

- **Ollama (default):** everything goes to the URL you configure — by default
  your own machine. Nothing leaves your vault.
- **Cloud providers:** your messages, the prompt parts above (identity,
  skill, custom instructions), and the active-note context when enabled are
  sent to that provider's servers. API keys are stored in plain text in the
  plugin's `data.json`.

The full list — per provider — is in
[Privacy and what is sent](AiProviders.md#privacy-and-what-is-sent).

## When something goes wrong

- **Model dropdown empty or an error under Model** — select **Refresh**;
  for cloud providers check the API key. Gemini keys that suddenly return
  401 need to be regenerated in Google AI Studio — see
  [AiProviders.md](AiProviders.md) and the README's troubleshooting section.
- **Reply looks like a hard error instead of streaming** — the plugin already
  retried without streaming; the error note under the reply explains what the
  provider returned.
- **Wrong or stale model** — the live line under the textarea always shows
  what will be used next; change it in **Settings → Community plugins →
  Study Agent**.

Deeper troubleshooting (plugin not loading, build issues) is in the
[README](../../README.md#troubleshooting); the code-level explanation of the
whole flow lives in the developer docs
([HowItWorks.md](../dev/HowItWorks.md)).

## See also

- [README — full user guide](../../README.md)
- [Skills.md](Skills.md) — built-in and custom skills
- [AiProviders.md](AiProviders.md) — provider setup and privacy
- Developer docs: [HowItWorks.md](../dev/HowItWorks.md) ·
  [ChatViewStructure.md](../dev/ChatViewStructure.md) ·
  [Settings.md](../dev/Settings.md)
