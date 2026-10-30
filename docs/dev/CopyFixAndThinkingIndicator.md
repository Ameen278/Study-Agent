# Copy-icon fix and Thinking indicator

This document explains two changes to the chat sidebar:

1. **The copy icon was broken** — it never appeared on replies. This was a
   rendering-pipeline bug; it is now fixed, and the icon also works while a
   reply is still streaming.
2. **A `Thinking...` placeholder** now stays visible until the first token
   arrives, so slow models and thinking models no longer leave a blank bubble.

## 1. Why the copy icon never appeared (bug)

### Root cause

`scheduleMarkdownRender()` started a `window.setTimeout` for **every token**
and never stored the timer ids. Consequences:

- When the stream ended, `finishPartial()` added the copy icon — but the last
  token's timer was still pending. It fired 0–250 ms later and re-rendered the
  bubble with `el.empty()`, destroying the freshly created button. The icon
  existed for a moment at most, so it looked like it never appeared.
- Timers also piled up (one per token), each rendering its own, possibly
  stale, slice of text — older text could overwrite newer text.

### Fix A — one debounced, cancellable timer

`src/ui/ChatView.ts` now keeps two fields:

```ts
private pendingRenderTimer: number | null = null;
private pendingRender: { el: HTMLElement; markdown: string } | null = null;
```

- `scheduleMarkdownRender()` stores the newest text in `pendingRender`. If a
  timer is already pending it does nothing; otherwise it schedules **the one**
  timer (`max(0, 250 - elapsed)`). The timer callback picks up the latest text
  when it fires, so extra tokens never spawn extra timers.
- `finishPartial()` calls `cancelPendingRender()` **first** (clears the timer
  and pending text), then awaits the render chain and does the final render.
  No callback can run after the reply is finalized, so nothing ever wipes the
  button again.
- `onClose()` cancels too, so no timer fires after the view closes.

### Fix B — the button lives outside the re-rendered area

Even with the timer fix, a button created *inside* a bubble that gets
`empty()`-ed on every streamed render would be fragile. The bubble structure
changed:

```text
.local-study-ai-message.assistant        (bubble: position: relative)
├── .local-study-ai-content              (only this is emptied/re-rendered)
└── .local-study-ai-copy                 (icon button: sibling, never emptied)
```

- `appendMessage()` creates the content wrapper; all rendering
  (`renderMarkdownInto`) and plain-text outcomes (`setBubbleText`, used for
  `Stopped.` and errors) target the wrapper — never the bubble — so siblings
  survive.
- `ensureCopyButton(bubble)` creates the icon **once** (idempotent check) and
  is called from `renderMarkdownInto()`, so the icon appears with the **first
  token** and stays for the reply's lifetime. `finishPartial()` calls it too,
  covering the non-streaming fallback path.
- Copy button CSS is unchanged (absolute, top-right of the bubble) because the
  bubble is still the positioning context.

### Copy while streaming (partial copy)

Because the button now exists during streaming, its click handler cannot rely
on text captured at creation time. A `WeakMap` keeps each bubble's current raw
Markdown:

```ts
private replyTexts = new WeakMap<HTMLElement, string>();
```

- Updated on every streamed token (`copyController.setReplyText(...)`) and by
  the render queue's `onRendered` hook (which also runs for the fallback path).
- The controller's `copyReply()` reads the stored text **at click time**:
  mid-stream it copies the partial text, after completion the full text.
  Selection-copy (from the earlier feature) takes precedence when a selection
  belongs to that bubble.

### Empty responses

A stream that finishes with zero tokens now throws the same
`ChatError("The AI returned an empty response...")` that `chat()` throws,
instead of leaving a blank bubble. It is shown like any other error and the
failed turn is dropped from history.

## 2. `Thinking...` placeholder while thinking

Previously the placeholder was created and immediately emptied
(`replyEl.empty()`), so the bubble was blank until the first token — a long
pause for a cold model or with **Enable thinking** on (reasoning happens
before the first visible token).

Now:

- The bubble starts with `Thinking...` text and the class
  `local-study-ai-thinking`; nothing empties it up front.
- The first render removes the class and replaces the content with real
  Markdown.
- Stop/error outcomes go through `setBubbleText()`, which also removes the
  class, so a failed or cancelled reply never keeps the placeholder styling.
- CSS (`styles.css`): the placeholder is faint, italic, and softly pulses
  (`local-study-ai-pulse` keyframes); the animation is disabled under
  `prefers-reduced-motion: reduce` (falls back to a static faint look).

## Files changed

| File               | Change                                                                     |
| ------------------ | -------------------------------------------------------------------------- |
| `src/ui/ChatView.ts` | Debounced/cancellable render timer, content wrapper, `ensureCopyButton`, `replyTexts` WeakMap, `Thinking...` placeholder, empty-response error |
| `styles.css`       | `local-study-ai-thinking` placeholder styles + pulse keyframes; edge-margin rules retargeted at `.local-study-ai-content > :first/:last-child` |
| `docs/dev/CopyFixAndThinkingIndicator.md` | This document                                            |

> **Note:** after the ChatView refactor (see
> [ChatViewStructure.md](ChatViewStructure.md)), the render timer lives in
> `src/ui/renderQueue.ts` and `ensureCopyButton`/`replyTexts` live in
> `src/ui/copyReply.ts`; the behaviour described here is unchanged.

Docs updated to match: `Streaming.md`, `ThinkingSwitchAndCopyIcon.md`,
`UiImprovements.md`, `HowItWorks.md`, `README.md`.

## Verification

1. Run `npm run build` and `npm run lint` (expect no errors).
2. Reload Obsidian and send a message.
3. **Thinking placeholder:** the bubble shows a faint pulsing `Thinking...`
   until the first token; it disappears on the first render and never lingers
   on `Stopped.` or error replies.
4. **Copy icon during streaming:** hover the bubble while tokens are still
   arriving — the clipboard icon is there; click it and paste: you get the
   text received so far.
5. **Copy icon after completion:** hover a finished reply → icon present;
   click → check icon for 1.5 s → paste → full raw Markdown (this is the
   regression that failed before: the icon used to vanish instantly).
6. **Selection copy:** select part of a reply (during or after streaming) →
   icon reveals → click → only the selection is pasted.
7. **Stop:** cancel mid-reply → partial text remains with its copy icon; stop
   before any token → `Stopped.` with no icon.
8. **Error:** stop Ollama and send → error message shown, no `Thinking...`
   styling, no copy icon on error-only bubbles.
9. **Empty reply:** if a model returns nothing, the empty-response error is
   shown instead of a blank bubble.
