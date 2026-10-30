# Skills

Skills are named instruction sets that switch the assistant into a focused
mode — study help, revision, summarizing, or anything you define yourself.
Choosing a skill injects its prompt into the request's system prompt, so the
model follows those instructions for every reply until you change the skill.

## How to use

1. Open the chat sidebar.
2. Find the **Skill** dropdown in the row under the input (next to
   **Use Active File as Context** and **Enable thinking**).
3. Pick a skill — for example **Revision**.
4. Chat as usual. Every message you send while the skill is selected is
   answered under that skill's instructions.

Notes:

- The selection is **sticky while the sidebar is open**: it applies to every
  message until you change it or pick **None**.
- It resets to **None** when the sidebar is reopened (it is not saved).
- If you delete the selected custom skill in settings, the dropdown resets to
  **None**.
- The active skill works together with **Use Active File as Context** and
  **Custom instructions** — see [Combining with other prompts](#combining-with-other-prompts).

## Built-in skills

| Skill        | Select it when you want…                                                |
| ------------ | ----------------------------------------------------------------------- |
| **Study help** | Clear step-by-step explanations grounded in your notes, with a short understanding-check question at the end. |
| **Revision**  | Active-recall quizzing: one question at a time, scored answers, weak-topic tracking, and a flashcard recap. |
| **Summarize** | A concise bullet summary of the active note or pasted content — key points, key terms, length limit respected. |

Example exchanges:

- **Study help** — ask *"Explain the Krebs cycle"* (with the note open and
  context on): you get the steps in order, terms defined, then one question
  checking you understood.
- **Revision** — select Revision and send *"Quiz me on this note"*: the model
  asks questions one at a time and grades each answer before moving on.
- **Summarize** — *"Summarize the open note in 10 bullets"*: bullets only,
  key terms included, no filler.

## Creating your own skills

1. Open **Settings → Community plugins → Study Agent**.
2. Scroll to **Custom skills** and select **Add skill**.
3. Enter a **Name** (shown in the chat's skill dropdown) and a **Prompt**
   (the instructions the model follows while the skill is selected).
4. Select **Save skill**. The skill appears in the chat's skill dropdown
   immediately — no restart needed.

To change one, select **Edit** on its row; to remove it, select **Delete**
and then **Confirm delete** (two clicks so you don't lose a skill by
accident). Custom skills are stored in the plugin's `data.json` next to your
other settings.

Prompt ideas for custom skills:

- **Practice problems** — *"Give me one problem at a time, wait for my
  answer, then show the solution only if I'm wrong."*
- **Socratic tutor** — *"Never give the answer directly; guide me with
  hints until I reach it myself."*
- **Vocabulary drill** — *"Pick 10 key terms from the active note and test
  me as flashcards."*

Built-in skills live in `src/skills.ts`; editing that file changes them
(rebuild with `npm run build`).

## Combining with other prompts

Every request's system prompt is assembled in this order:

1. **Study-assistant identity** — always on.
2. **The selected skill** — its instructions, marked with the skill's name.
3. **Custom instructions** — your settings text (your own words override
   skill behavior).
4. **Active-note context** — the open note, when the context switch is on.

Pick **None** to send only 1 + 3 (+ 4 when enabled).

## Privacy

The selected skill's prompt — built-in or custom — is sent to the configured
AI provider with every message, alongside your conversation, custom
instructions, and any active-file context. See
[AiProviders.md](AiProviders.md#privacy-and-what-is-sent).

## Files

| File                        | Role                                                       |
| --------------------------- | ---------------------------------------------------------- |
| `src/skills.ts`             | Skill type, the three built-ins, lookup and id helpers.    |
| `src/ui/systemPrompt.ts`    | Injects the skill between identity and custom instructions.|
| `src/ui/ChatView.ts`        | The **Skill** dropdown (populate, refresh, resolve).       |
| `src/ui/SkillModal.ts`      | New/Edit skill modal (name + prompt, validation).          |
| `src/ui/skillSettings.ts`   | Custom skills section of the settings tab.                 |
| `src/settings.ts`           | `customSkills` field, defaults, and migration.             |

## Testing

1. `npm run build` and `npm run lint`.
2. Reload the plugin; confirm the **Skill** dropdown shows
   **None / Study help / Revision / Summarize**.
3. Select **Revision** and ask a question — the reply should quiz rather than
   explain; switch back to **None** and confirm normal behavior.
4. Create a custom skill in settings, confirm it appears in the dropdown,
   select it, and check replies follow its prompt.
5. Edit and delete the custom skill; confirm the dropdown resets to **None**
   when the selected skill is deleted.
6. Reopen the sidebar and confirm the dropdown is back to **None**.
