# UI improvements: copy icon, selection copy, and switch styling

This document covers the sidebar's interactive extras: the copy icon on
replies, copying part of a reply, and the card-style switches below the input.
The **Enable thinking** switch is explained in more detail in
[ThinkingSwitchAndCopyIcon.md](ThinkingSwitchAndCopyIcon.md).

## 1. Copy icon on replies

### What it does

Every assistant reply gets a small icon button in its top-right corner:

- Shows Obsidian's **copy** (clipboard) icon; text-free and square.
- Created with the **first streamed token** (or after the non-streaming
  fallback) and stays for the reply's lifetime — re-renders cannot remove it.
- Hidden until the bubble is hovered, until the button receives keyboard
  focus (`Tab`), or until a selection exists inside the bubble.
- Clicking copies the reply's raw Markdown: the **partial** text while the
  reply is still streaming, the complete text after it finishes — or just the
  **selected text** when a selection lies inside the reply (see next section).
- The icon changes to a **check** for 1.5 seconds after a successful copy, or
  an **x** when the clipboard is unavailable, then reverts.
- User messages and error-only bubbles never get a button.

> An earlier version of this feature was broken: a stray render timer fired
> after finalization and wiped the button, so the icon never appeared. See
> [CopyFixAndThinkingIndicator.md](CopyFixAndThinkingIndicator.md) for the
> root cause and fix (debounced timer + content wrapper).

### Code — `src/ui/ChatView.ts`

Each bubble holds a `.local-study-ai-content` wrapper for everything that is
re-rendered; the button is a **sibling** of that wrapper, so
`content.empty()` during streaming leaves it untouched:

```ts
// idempotent: called after every render, creates the button only once
private ensureCopyButton(bubble: HTMLElement): void {
	if (bubble.querySelector('.local-study-ai-copy')) return;

	const copyButton = bubble.createEl('button', {
		cls: 'local-study-ai-copy',
		attr: { type: 'button', 'aria-label': 'Copy reply' },
	});
	setIcon(copyButton, 'copy');

	this.registerDomEvent(copyButton, 'pointerdown', (event) => {
		event.preventDefault(); // keep the text selection alive for the click
	});

	this.registerDomEvent(copyButton, 'click', () => {
		void this.copyReply(bubble, copyButton);
	});
}
```

`registerDomEvent` is used so Obsidian removes the listeners with the view's
lifecycle. `copyReply()` reads the bubble's current text from the `replyTexts`
WeakMap (updated on every token), writes to the clipboard, swaps the icon to
`check`/`x`, and resets it after 1.5 seconds (guarded by `isConnected` so a
closed view is never touched).

## 2. Copying a selected part of a reply

Select text inside an assistant reply:

- The copy icon reveals automatically (class `local-study-ai-copy-shown`) and
  its `aria-label` becomes **Copy selected text**.
- Clicking copies the selection as plain rendered text; clicking without a
  selection still copies the whole reply's Markdown.

A document-level `selectionchange` listener (registered with
`registerDomEvent` in `onOpen()`) records the selection text and its bubble in
`updateSelectionState()`. The selection is captured when it happens, and the
button's `pointerdown` prevents the press from clearing it, so the `click`
handler always sees the right text.

Limits: partial copy returns what you see (headings lose their `##` markers),
and a selection spanning two replies attaches to the reply where it started.

## 3. Switch styling (context and thinking)

### What it does

The two form switches — **Use Active File as Context** and **Enable
thinking** — share one card-style row:

- Each switch is a card with a border, muted small text, and a custom switch
  (34×18 track, 14px sliding knob).
- Hover highlights the card; keyboard focus draws an outline around it; the
  checked state adds an accent border.
- The cards sit side by side in `.local-study-ai-toggles` and wrap to a
  stacked layout when the sidebar is narrow.
- The row markup is built in `ChatView.onOpen()`; the thinking switch
  reads/writes the saved `ollamaThink` setting (see
  [ThinkingSwitchAndCopyIcon.md](ThinkingSwitchAndCopyIcon.md)).

### CSS — `styles.css`

Shared class `.local-study-ai-switch` (renamed from
`.local-study-ai-context-toggle`):

```css
.local-study-ai-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.local-study-ai-switch {
  flex: 1 1 200px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--background-modifier-border);
  /* hover, focus-within, and :has(input:checked) states follow */
}

.local-study-ai-switch input {
  appearance: none;
  width: 34px;
  height: 18px;
  border-radius: 999px;
  background: var(--background-modifier-border);
}
```

Details:

- `flex-wrap: wrap` keeps long label text from overflowing the narrow sidebar.
- `:has()` is supported by the Electron/Chromium versions bundled with every
  Obsidian build at or above this plugin's `minAppVersion` (1.7.2).
- `user-select: none` stops text selection when clicking a switch.
- Transitions are disabled under `prefers-reduced-motion: reduce`.

## Files changed

| File                     | Change                                                     |
| ------------------------ | ---------------------------------------------------------- |
| `src/ui/ChatView.ts`     | Copy icon, selection tracking/copy, switch row, thinking switch |
| `src/main.ts`            | Settings listener hook for two-way switch sync             |
| `styles.css`             | Icon button, `.local-study-ai-copy-shown`, `.local-study-ai-toggles`, `.local-study-ai-switch` |

## Verification

1. Run `npm run build` and `npm run lint`.
2. Reload Obsidian and send a message.
3. Hover the reply → copy icon appears; click → check icon → paste into a note
   and confirm the Markdown is intact.
4. Select part of a reply → icon reveals on its own; click → only the selected
   text is pasted.
5. `Tab` to the icon and press Enter; confirm it is keyboard reachable.
6. Confirm error bubbles have no copy icon.
7. Flip both switches; confirm the layout wraps on a narrow sidebar and the
   thinking switch persists across reloads.
