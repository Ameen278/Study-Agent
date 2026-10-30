# ChatView structure and the model line

This document covers the split of the original monolithic
`ChatView.ts` (721 lines) into focused modules, the `Provider · model`
line under the chat input, the always-on system prompt, and the skill
dropdown.

## Why the view was split

`AGENTS.md` asks for files of at most ~200-300 lines with a single
responsibility. The original `ChatView.ts` mixed six concerns: DOM building,
the send/stop orchestration, the throttled Markdown render pipeline, copy-icon
and selection handling, the active-file context prompt, and error-type
predicates. Each is now its own module; `ChatView` composes them.

## File map

| File                       | Lines | Responsibility                                                    |
| -------------------------- | ----- | ----------------------------------------------------------------- |
| `src/ui/ChatView.ts`       | ~440  | Lifecycle (`onOpen`/`onClose`), state, `sendMessage`, Stop, the switches, the skill dropdown, the model line. |
| `src/ui/renderQueue.ts`    | ~145  | `RenderQueue`: throttled Markdown rendering (single timer + render chain). |
| `src/ui/copyReply.ts`      | ~195  | `CopyReplyController`: copy icon, selection copy, `replyTexts` map; `appendErrorNote`. |
| `src/ui/bubbles.ts`        | ~60   | Bubble DOM helpers: `appendMessage`, `replyContent`, `setBubbleText`, `scrollToEnd`. |
| `src/ui/activeFileContext.ts` | ~55 | `buildActiveFileContext(app, enabled)` — active-note context block. |
| `src/ui/systemPrompt.ts`   | ~65   | `STUDY_ASSISTANT_PROMPT` + `composeSystemPrompt(...)` — identity, skill, custom instructions, context. |
| `src/ui/SkillModal.ts`     | ~85   | New/Edit custom skill modal (name + prompt + validation).          |
| `src/ui/skillSettings.ts`  | ~90   | Custom skills section of the settings tab (add/edit/delete).       |
| `src/ui/chatErrors.ts`     | ~36   | `isAbortError`, `isNetworkTypeError`, `toChatErrorMessage`.        |

### How the collaborators fit together

```text
ChatView (state + orchestration)
├── RenderQueue            schedule/finish; onRendered hook →
│     └── (hook)           setReplyText + ensureCopyButton on the controller
├── CopyReplyController    replyTexts WeakMap, hover/focus/selection copy
├── bubbles.ts             appendMessage / setBubbleText / scrollToEnd
├── activeFileContext.ts   active-note context block
├── systemPrompt.ts        identity + skill + custom instructions + context → system prompt
├── skills.ts              built-in + custom skill registry (Skill dropdown)
├── chatErrors.ts          abort/network detection, error messages
└── createChatService      the provider client (ChatService.ts)
```

Construction happens once in the `ChatView` constructor (queue + controller),
wiring happens in `onOpen` (DOM, listeners, `copyController.activate()`), and
teardown in `onClose` (abort, `renderQueue.cancel()`, `copyController.detach()`,
settings unsubscribe, field nulling).

### Behaviour preserved by construction

- **Render throttle** — `RenderQueue` keeps the exact original algorithm: one
  pending timer (latest render wins), `lastRenderAt`-based delay of at most
  250 ms, and a promise chain so renders never overlap. First token renders
  immediately (`lastRenderAt` starts at 0).
- **Copy-icon wipe fix** — `RenderQueue.finish()` still calls `cancel()`
  *before* awaiting the chain and doing the final render, so no stale timer
  can empty the bubble after `ensureCopyButton` ran.
- **Copy button lifetime** — the `onRendered` hook runs after every render
  (idempotent `ensureCopyButton`) and stores the current raw Markdown in the
  controller's `replyTexts`, read at click time (partial text mid-stream).
- **Stop/fallback** — `sendMessage` is unchanged logic-wise: abort handling,
  `TypeError`-before-first-token fallback to `chat()`, partial-text retention,
  history pops on error, empty-reply `ChatError`.
- **Finish contract** — `RenderQueue.finish()` returns `false` only for an
  aborted-and-empty reply (it shows `Stopped.`); `ChatView.finishPartial`
  pushes history only when it returns `true`.

## The system prompt

Every request carries a system prompt assembled by `composeSystemPrompt()`
(`src/ui/systemPrompt.ts`), regardless of the **Use Active File as Context**
switch:

1. **Study-assistant identity** (`STUDY_ASSISTANT_PROMPT`) — always sent, so
   the model knows it is a study assistant inside the user's Obsidian vault.
2. **Active skill** — the prompt of the skill selected in the Skill dropdown
   (Study help, Revision, Summarize, or a custom skill), wrapped with the
   skill's name so the model treats it as the current mode.
3. **Custom instructions** — the optional settings field, appended when
   non-empty (the user's own words come after the skill, so they win).
4. **Active-note context** — the `buildActiveFileContext()` block, appended
   when the context switch is on.

`ChatView.sendMessage()` passes the result as `options.system`, which every
provider service honours: Anthropic hoists it to the top-level `system`
field, while Ollama and the OpenAI-compatible services prepend a leading
`system` message.

### The Skill dropdown

- Options come from `allSkills(settings)` in `src/skills.ts` — the three
  built-ins plus valid custom skills — built by `populateSkillOptions()`.
- The selection is view state (like the context checkbox): sticky while the
  sidebar is open, reset to **None** when the view reopens, and forced back
  to **None** when the selected skill is deleted — the settings listener
  re-populates and falls back when the id no longer exists.
- `sendMessage()` resolves the selected id with `findSkill()` and hands the
  skill to `composeSystemPrompt()`.

## The model line

A muted line sits between the textarea and the switch row:

```text
┌──────────────────────────────┐
│ Ask your local AI...         │  ← textarea
├──────────────────────────────┤
│ Gemini · gemini-2.5-flash    │  ← .local-study-ai-model-info
│ [Use Active File] [Thinking] │
│ [Skill ▾ None]               │  ← .local-study-ai-skill-select
└──────────────────────────────┘
```

- Text comes from `activeModelLabel(settings)` in `src/ChatService.ts`:
  `presetLabel(provider) · model`, or `… · no model selected` when the model
  field is empty.
- It shows **what the next message will use**, so it must stay live: the
  existing settings listener (registered in `onOpen`, unsubscribed in
  `onClose`) also calls `updateModelInfo()` after every `saveSettings()`.
  Switching provider/model in the settings tab updates the line immediately.
- Styles live in `styles.css` (`.local-study-ai-model-info`: `0.75em`,
  `--text-faint`, `overflow-wrap: anywhere`).

## Files touched

| File                     | Change                                                            |
| ------------------------ | ----------------------------------------------------------------- |
| `src/ui/ChatView.ts`     | Rewritten as the slim orchestrator (721 → ~410 lines).            |
| `src/ui/renderQueue.ts`  | New — rendering pipeline extracted from the view.                 |
| `src/ui/copyReply.ts`    | New — copy/selection controller + `appendErrorNote`.              |
| `src/ui/bubbles.ts`      | New — bubble DOM helpers.                                         |
| `src/ui/activeFileContext.ts` | New — active-note prompt builder.                            |
| `src/ui/chatErrors.ts`   | New — error predicates and message formatting.                   |
| `src/ChatService.ts`     | Added `activeModelLabel()`.                                       |
| `styles.css`             | Added `.local-study-ai-model-info`.                               |
| `docs/dev/HowItWorks.md`  | File map and sidebar-structure sections updated.                  |
| `docs/dev/Streaming.md`, `docs/dev/CopyFixAndThinkingIndicator.md` | Notes updated for the new module locations. |

## Testing

1. `npm run build` and `npm run lint`.
2. Reload the plugin; confirm streaming, **Stop**, the copy icon (hover and
   selection), `Thinking...`, and the CORS fallback all behave as before.
3. Change provider/model in settings and watch the line under the textarea
   update without reopening the sidebar.
4. Clear the model in settings and confirm `… · no model selected` appears.
