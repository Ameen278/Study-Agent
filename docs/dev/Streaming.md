# Streaming replies

This document explains how the plugin streams model replies token by token:
how `OllamaService.chatStream()` works, how `ChatView` renders partial Markdown,
how the user stops a reply, and what happens when streaming is unavailable.

## Overview

When you send a message, Ollama answers in newline-delimited JSON
(`application/x-ndjson`), one small piece at a time. The plugin reads each piece
as it arrives and re-renders the assistant bubble with
`MarkdownRenderer.render`, so the reply grows in real time like a typical chat
UI.

Two request paths exist:

| Method                   | Transport           | Behavior                                          |
| ------------------------ | ------------------- | ------------------------------------------------- |
| `OllamaService.chatStream()` | browser `fetch`     | Streams tokens; cancellable via `AbortSignal`.     |
| `OllamaService.chat()`       | Obsidian `requestUrl` | Returns the full reply at once; reliable fallback. |

## Why `fetch` for streaming

Obsidian's `requestUrl` cannot read a response incrementally — it resolves with
the complete body only. Token-by-token output therefore uses the browser
`fetch` API with a `ReadableStream`.

The catch is CORS: `fetch` is subject to the browser's same-origin rules, while
`requestUrl` is not. Ollama solves this out of the box: it returns
`Access-Control-Allow-Origin: app://obsidian.md` (the Obsidian desktop origin)
on its API responses, so `fetch` from the app works without a proxy.

If streaming is blocked anyway (older Ollama, proxy stripping headers, etc.),
`fetch` rejects with a `TypeError` **before any token arrives**. `ChatView`
detects this and automatically falls back to the non-streaming `chat()`. The
user sees the same result, just all at once instead of streamed.

## `OllamaService.chatStream()`

```ts
async *chatStream(
	messages: OllamaMessage[],
	options: OllamaChatOptions = {},
	signal?: AbortSignal,
): AsyncGenerator<string, void, void>
```

1. Builds the same JSON body as `chat()`, but with `"stream": true`.
2. Calls `fetch(`${baseUrl}/api/chat`, { method: "POST", body, signal })`.
3. Checks `response.ok` and `response.body`; failures throw `OllamaError`.
4. Reads the body with `response.body.getReader()` and a `TextDecoder`,
   splitting the byte stream into lines.
5. Parses each line with `parseStreamChunk()`:
   - `{"message":{"content":"Hel"},"done":false}` → yields `"Hel"`.
   - `{"message":{"content":""},"done":true}` → ends the generator.
   - `{"error":"model not found"}` → throws `OllamaError`.
6. A trailing line without a trailing newline is flushed after the loop.

Because network chunks can split a JSON line anywhere, incomplete lines are
kept in a buffer until the rest arrives.

### Aborting

Pass an `AbortSignal` to cancel the stream (used by the **Stop** button and by
`onClose()`). Cancelling rejects the pending `reader.read()` with an
`AbortError`, which `ChatView` treats as a user stop rather than a failure.

## How `ChatView` streams

```text
User presses Enter
        |
        v
setSending(true)            input disabled, button becomes "Stop"
append user bubble + history
assistant bubble starts as "Thinking..." (local-study-ai-thinking)
        |
        v
for await (delta of chatStream(history, options, signal))
        |
        |-- partial += delta, copyController.setReplyText(bubble, partial)
        |-- renderQueue.schedule(bubble, partial)         (debounced ~250ms)
        |-- first render: drops "Thinking...", renders Markdown,
        |   creates the copy icon (it exists from the first token on)
        |
        v  (stream ends)
finishPartial() → renderQueue.finish(): cancel pending timer → final render
        → history push
setSending(false)           button back to "Send"
```

### Debounced rendering

Ollama can emit dozens of deltas per second. Re-rendering Markdown on every
token would overwhelm the UI thread, so renders are debounced inside
`RenderQueue` (`src/ui/renderQueue.ts`):

- **One timer exists at a time.** `renderQueue.schedule()` stores the newest
  `partial` in `pendingRender`; extra tokens while a timer is pending just
  replace that text. When the timer fires (at most once per
  `RENDER_INTERVAL_MS`, 250 ms) it renders the latest text. No stale text can
  overwrite newer text, and timers no longer pile up per token.
- Each render is chained onto `renderChain` (a `Promise` pipeline) so two
  `MarkdownRenderer.render` calls never interleave inside the same bubble.
- The **first** delta renders immediately (no initial delay) so the reply
  appears as soon as possible — and replaces the `Thinking...` placeholder.
- When the stream finishes, `renderQueue.finish()` **cancels the pending timer
  first**, awaits the chain, and does one last render of the complete text.
  Cancelling first is essential: previously the last token's timer fired after
  finalization and `el.empty()` destroyed the copy icon (see
  [CopyFixAndThinkingIndicator.md](CopyFixAndThinkingIndicator.md)).

Only the display is Markdown; the raw accumulated text stays in `history` for
the next turn, and in the copy controller's per-bubble `replyTexts` map for
the copy icon.

### The `Thinking...` placeholder

The assistant bubble is **not** emptied when the message is sent: it shows a
faint, pulsing `Thinking...` (class `local-study-ai-thinking`) until the first
token or an error replaces it. Stop and error outcomes go through
`setBubbleText()`, which clears the placeholder styling as well.

### Stopping a reply

While streaming, the Send button is relabeled **Stop** (and stays enabled).
Clicking it (or pressing Enter in the empty input) calls
`abortController.abort()`:

- If some text has already arrived, the partial reply is finalized (final
  render, pushed to history); its copy icon stays and copies the partial text.
- If nothing has arrived yet, the assistant bubble shows `Stopped.` and the
  user turn is popped from history so the next send starts clean.
- Closing the sidebar (`onClose()`) aborts any in-flight stream and cancels
  the pending render timer the same way.

### Copy icon while streaming

The copy icon is created with the **first token** (as a sibling of the
re-rendered content wrapper, so no render can remove it) and remains after
completion. Clicking it copies the bubble's current raw Markdown — the partial
text mid-stream, the full text afterwards — or just the selected text when a
selection belongs to that bubble.

### Error handling while streaming

- **AbortError** → user stop (see above); not shown as an error.
- **TypeError before any token** → automatic fallback to `service.chat()`
  (non-streaming, `requestUrl`, no CORS). The full reply is rendered normally;
  the `Thinking...` placeholder stays visible while the fallback runs.
- **Zero tokens on a normal completion** → `ChatError` ("The AI returned an
  empty response..."), same as the non-streaming `chat()`.
- **Other errors**:
  - If some text was already received, it is kept (rendered, copy icon intact)
    and a small `.local-study-ai-error` note is appended under the bubble.
  - If nothing was received, the error message replaces the bubble content and
    the user turn is popped from history (same as the non-streaming path).

## Styles

- `.local-study-ai-thinking` — faint, italic, softly pulsing `Thinking...`
  placeholder (disabled under `prefers-reduced-motion`).
- `.local-study-ai-error` — red error note appended under a partial reply when
  the stream fails mid-way; separated by a top border so it reads as an add-on
  to the answer above it.
- The Send/Stop button uses the existing `.local-study-ai-form button` styles;
  only its label and `aria-label` change with the state.
- The copy icon (`.local-study-ai-copy`) is revealed by bubble hover, keyboard
  focus, or a selection inside the bubble (`.local-study-ai-copy-shown`).

## Verifying streaming works

1. Make sure Ollama is running and you picked a fast model (for example
   `qwen2.5-coder:1.5b`).
2. Open the sidebar and send a short prompt.
3. The bubble shows a pulsing `Thinking...` until the first token, then the
   reply appears word by word within a few hundred milliseconds of that token,
   not all at once at the end.
4. While tokens are still arriving, hover the bubble: the copy icon is there.
   Click it and paste — you get the text received so far.
5. After completion, hover again: the copy icon is still present (it used to
   be wiped by a stray render timer — see
   [CopyFixAndThinkingIndicator.md](CopyFixAndThinkingIndicator.md)); clicking
   now pastes the full raw Markdown.
6. Click **Stop** mid-reply; generation should halt and any partial text stays.
7. Stop Ollama (`Ctrl+C` in the server terminal) and send a message; you should
   get the "Could not reach Ollama" error, not a hang, and no lingering
   `Thinking...` styling.
8. To confirm the fallback path, block CORS (for example run Ollama behind a
   proxy that strips `Access-Control-Allow-Origin`) and send a message; the
   reply should still appear, just all at once, with `Thinking...` visible
   until it does.

## Related

- [Copy-icon fix and Thinking indicator](CopyFixAndThinkingIndicator.md) — the
  render-timer bug behind the missing copy icon and the placeholder's design.
- [How it works](HowItWorks.md) — full request lifecycle.
- [OllamaService reference](OllamaService.md) — API details for both methods.
- [Markdown rendering](MarkdownRendering.md) — how replies are formatted.
