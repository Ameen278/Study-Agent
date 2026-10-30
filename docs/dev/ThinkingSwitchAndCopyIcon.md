# Thinking switch and copy icon (sidebar UI update)

This document explains two UI changes made to the chat sidebar:

1. An **Enable thinking** switch added to the sidebar interface, kept in sync
   with the saved setting.
2. The reply **Copy** text button replaced by a **clipboard icon** that appears
   with the first streamed token and lets you copy a selected part of a reply
   or the partial text still streaming.

   > A follow-up fix corrected the copy icon (it was wiped by a stray render
   > timer) and added the `Thinking...` placeholder — see
   > [CopyFixAndThinkingIndicator.md](CopyFixAndThinkingIndicator.md).

## 1. Enable thinking switch in the sidebar

### What it does

The sidebar form now shows two switches side by side below the textarea:

- **Use Active File as Context** (existing switch, restyled).
- **Enable thinking** (new).

The thinking switch controls the same `ollamaThink` setting as the
**Enable thinking** toggle in **Settings → Community plugins → Study Agent**:

- On open, the switch shows the saved value.
- Flipping the switch saves the setting immediately (`saveSettings()`).
- If the setting changes in the settings tab while the sidebar is open, the
  sidebar switch updates automatically, and vice versa.
- `sendMessage()` keeps reading `settings.ollamaThink`, so the switch always
  matches what is sent to Ollama.

### Code

#### `src/ui/ChatView.ts`

- New field `thinkCheckboxEl` holds the checkbox.
- `onOpen()` builds a `div.local-study-ai-toggles` row containing both switch
  labels (class `local-study-ai-switch`):

  ```ts
  const toggles = form.createDiv({ cls: 'local-study-ai-toggles' });

  const thinkToggle = toggles.createEl('label', { cls: 'local-study-ai-switch' });
  const thinkCheckbox = thinkToggle.createEl('input', { attr: { type: 'checkbox' } });
  thinkCheckbox.checked = this.plugin.settings.ollamaThink;
  thinkToggle.createSpan({ text: 'Enable thinking' });

  this.registerDomEvent(thinkCheckbox, 'change', () => {
  	this.plugin.settings.ollamaThink = thinkCheckbox.checked;
  	void this.plugin.saveSettings();
  });
  ```

- A settings listener registered in `onOpen()` refreshes the checkbox whenever
  the plugin saves settings (for example from the settings tab):

  ```ts
  this.unsubscribeSettings = this.plugin.registerSettingsListener(() => {
  	if (this.thinkCheckboxEl) {
  		this.thinkCheckboxEl.checked = this.plugin.settings.ollamaThink;
  	}
  });
  ```

  `onClose()` calls the returned unsubscribe function so no stale listeners
  accumulate when the view closes and reopens.

#### `src/main.ts`

The plugin gained a tiny pub/sub for settings changes:

- `private settingsListeners = new Set<() => void>()`.
- `saveSettings()` notifies all listeners after `saveData()` completes.
- `registerSettingsListener(listener)` adds a callback and returns its
  unsubscribe function.

This keeps settings as the single source of truth while letting open views
stay current without polling.

### CSS — `styles.css`

- The old `.local-study-ai-context-toggle` selectors were renamed to the
  shared class `.local-study-ai-switch`, applied to both cards. The card
  look (border, hover, focus ring, sliding knob, reduced-motion handling) is
  unchanged.
- New row container:

  ```css
  .local-study-ai-toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .local-study-ai-switch {
    flex: 1 1 200px;
    /* ...card styles... */
  }
  ```

  Each card takes half the row when there is room and wraps to a stacked
  layout in a narrow sidebar.

## 2. Copy icon with partial-selection copy

### What it does

Every assistant reply gets a hover/focus button in its top-right corner — an
icon-only button showing Obsidian's **copy** (clipboard) icon. It is created
with the **first token** and stays for the reply's lifetime:

- **No selection** — clicking copies the reply's raw Markdown: the partial
  text while it is still streaming, the complete text afterwards.
- **Selection inside the reply** — while you select part of a reply, the icon
  reveals automatically and its label changes to **Copy selected text**;
  clicking copies just the selected text (as rendered, plain text).
- After a click the icon swaps to a **check** for 1.5 seconds (**x** if the
  clipboard write fails), then returns to the clipboard icon.
- User messages and error-only bubbles never get a button.

### Code — `src/ui/copyReply.ts` (moved from `ChatView.ts`)

- Bubbles contain a `.local-study-ai-content` wrapper that holds everything
  re-rendered during streaming; the copy button is a **sibling** of that
  wrapper, so `content.empty()` can never delete it.
- `ensureCopyButton()` creates the button once (idempotent) and renders the
  icon with Obsidian's `setIcon(copyButton, 'copy')`; it runs from the render
  queue's `onRendered` hook — i.e. with the first token — and after the final
  render in `finishPartial()` for the non-streaming fallback.
- Each bubble's current raw Markdown lives in the copy controller's
  `replyTexts` (`WeakMap<HTMLElement, string>`), updated on every token. The
  click handler reads it **at click time**, which is what makes partial copy
  work.
- A `pointerdown` handler on the button calls `preventDefault()` so pressing
  the icon does not collapse the text selection before the `click` handler
  runs. Keyboard use (Tab + Enter) still works.
- A document-level `selectionchange` listener (registered with
  `registerDomEvent`, so Obsidian cleans it up with the view) drives
  `updateSelectionState()`:

  ```ts
  const selection = window.getSelection();
  // when the selection is non-collapsed and inside an assistant bubble:
  this.selectedText = range.toString();
  this.selectedBubble = bubble;
  bubble.addClass('local-study-ai-copy-shown');
  button.setAttribute('aria-label', 'Copy selected text');
  // otherwise the recorded selection is cleared and the reveal class removed
  ```

- `copyReply()` decides what to copy:

  ```ts
  const useSelection =
  	this.selectedBubble === bubble && this.selectedText !== '';
  const markdown = this.getReplyText(bubble);
  const text = useSelection ? this.selectedText : markdown;
  ```

  then writes `text` to the clipboard and shows the `check`/`x` feedback icon.
- The selection is captured at `selectionchange` time (and the press is
  neutralized with `pointerdown`), so the click handler never loses the
  selection.

### CSS — `styles.css`

- `.local-study-ai-copy` is now a square 24×24 icon button; the SVG inside is
  14×14 with `pointer-events: none`.
- New reveal rule: in addition to bubble hover and `:focus-visible`, the icon
  appears when its bubble has `.local-study-ai-copy-shown` (selection inside).

  ```css
  .local-study-ai-message.assistant:hover .local-study-ai-copy,
  .local-study-ai-message.assistant.local-study-ai-copy-shown .local-study-ai-copy,
  .local-study-ai-copy:focus-visible {
    opacity: 1;
  }
  ```

### Notes and limits

- Partial copy returns the **rendered text** (what you see): a heading copied
  from a reply will not contain `##` markers, because the raw Markdown range
  for a selection is not tracked.
- Selecting across two replies copies the full range but attaches the copy to
  the reply where the selection started.
- The `aria-label` on a button that just showed "Copied" feedback resets on
  the next selection change; purely cosmetic.

## Files changed

| File               | Change                                                             |
| ------------------ | ------------------------------------------------------------------ |
| `src/ui/ChatView.ts` | Switch row, thinking switch, settings listener, copy icon, selection copy |
| `src/main.ts`      | `registerSettingsListener()` + notification inside `saveSettings()` |
| `styles.css`       | `.local-study-ai-toggles`, `.local-study-ai-switch` rename, icon button, `.local-study-ai-copy-shown` |
| `docs/dev/ThinkingSwitchAndCopyIcon.md` | This document                                    |

## Verification

1. Run `npm run build` and `npm run lint` (no errors).
2. Reload Obsidian.
3. **Thinking switch:**
   - Flip **Enable thinking** in the sidebar → open the settings tab and
     confirm **Enable thinking** matches.
   - Flip it in the settings tab → confirm the sidebar switch updates while
     the sidebar stays open.
   - Send a message with thinking on and confirm slower, reasoning-style
     answers from a thinking model (e.g. `qwen3.5`).
   - Reload Obsidian and confirm the switch keeps its state (persisted).
4. **Switch layout:** confirm the two switches sit side by side and stack on
   a narrow sidebar.
5. **Copy icon:**
   - Hover a reply → clipboard icon appears; click → check icon for 1.5 s;
     paste into a note and confirm the full raw Markdown.
   - Select a sentence inside a reply → icon appears without hovering;
     click → only that sentence is on the clipboard.
   - Click with no selection → the whole reply is copied.
   - Keyboard: Tab to the icon, press Enter → copy works without a mouse.
   - Confirm user messages and error bubbles have no copy icon.
