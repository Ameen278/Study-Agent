# Settings

`src/settings.ts` stores the plugin configuration and renders the controls shown
in **Settings → Community plugins → Study Agent**.

## Stored shape

```ts
export interface ObsidianAgentSettings {
	provider: ProviderId; // which backend is active
	providers: Record<ProviderId, ProviderConfig>; // per-provider config
	ollamaThink: boolean; // Ollama thinking models only
	customInstructions: string; // extra instructions for every request
	customSkills: Skill[]; // user-defined skills for the chat dropdown
}

export interface ProviderConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
}
```

| Field                          | Default                 | Meaning                                            |
| ------------------------------ | ----------------------- | -------------------------------------------------- |
| `provider`                     | `'ollama'`              | Active provider id (`ollama`, `openai`, ...).      |
| `providers.ollama.baseUrl`     | `http://localhost:11434`| Address of the local Ollama server.                |
| `providers.ollama.model`       | `llama3.2`              | Model used when chatting (Ollama).                 |
| `providers.<id>.baseUrl`       | per provider            | API root for OpenAI, Claude, OpenRouter, Groq.     |
| `providers.<id>.apiKey`        | `''`                    | API key (plain text in `data.json`).               |
| `providers.<id>.model`         | `''` (except Ollama)    | Model id used when chatting.                       |
| `ollamaThink`                  | `false`                 | Whether Ollama thinking models reason first.       |
| `customInstructions`           | `''`                    | Extra instructions appended to the system prompt.  |
| `customSkills`                 | `[]`                    | User-defined skills shown in the chat's skill dropdown. |

`ProviderId` is defined in `src/ChatService.ts` together with
`PROVIDER_PRESETS`, which lists every shipped provider (label, default base
URL, whether a key is required, and a one-line hint).

## Loading, migration, and saving

`main.ts` calls `migrateSettings(await this.loadData())` (defined in
`settings.ts`):

1. Fresh defaults come from `defaultProvidersRecord()`.
2. Saved `providers` entries are merged in field by field.
3. **Legacy fields** `ollamaBaseUrl` and `ollamaModel` (from the old flat
   settings shape) are adopted into `providers.ollama` so existing setups keep
   their server URL and model after upgrading. The old keys are dropped on the
   next save.
4. `provider` falls back to `'ollama'` when missing or unknown.
5. `customInstructions` is kept when it is a string; otherwise it falls back
   to `''`.
6. `customSkills` is kept when it is an array; entries without a non-empty
   string `id`, `name`, and `prompt` are dropped (duplicate ids are ignored at
   read time by `allSkills()` in `src/skills.ts`).

`saveSettings()` writes the whole object back to `data.json` and notifies
`settingsListeners`, so open views (the chat sidebar's thinking switch and
visibility) refresh after every save.

## Settings tab UI

`ObsidianAgentSettingTab.getSettingDefinitions()` (the declarative settings
API, Obsidian 1.13+) rebuilds the row list whenever the provider changes.
Each row uses the `render` escape hatch and reuses the same imperative
builders, because the tab is dynamic (provider-dependent fields, async model
loading, skill CRUD with modals):

1. **AI provider** — dropdown over `PROVIDER_PRESETS`; selecting one saves
   `provider` and re-renders the tab. A hint line under the dropdown explains
   whether the provider is local or cloud.
2. **Base URL** — text field bound to the active provider's `baseUrl`, with
   the preset default as placeholder.
3. **API key** — masked password field bound to `apiKey`, shown for providers
   that need a key and for Custom. The description warns that the key is
   stored in plain text in `data.json`.
4. **Model** — dropdown plus **Refresh** button. On open (and on Refresh) it
   calls `createChatService(this.plugin.settings).listModels()` for the active
   provider, fills the dropdown, and keeps the saved model visible as
   `name (not listed)` when the server no longer returns it. If the list is
   empty and a model was just chosen, the first listed model is saved.
5. **Enable thinking** — only rendered while the Ollama provider is active.
6. **Custom instructions** — multiline box (always rendered, provider
   independent) bound to `customInstructions`. The description notes the text
   is appended after the built-in study-assistant prompt and is sent to the
   AI provider with every request.
7. **Custom skills** — rendered by `renderSkillsSection()`
   (`src/ui/skillSettings.ts`): an **Add skill** button plus one row
   (prompt preview, **Edit**, two-step **Delete**) per entry. Add/Edit open
   `SkillModal` (`src/ui/SkillModal.ts`) with **Name** and **Prompt** fields;
   empty fields show an inline error. Built-in skills (Study help, Revision,
   Summarize) are not listed here — they live in `src/skills.ts` and always
   appear in the chat's skill dropdown.

`ChatView` also hides its **Enable thinking** switch unless Ollama is active
(`updateThinkSwitchVisibility()`), because other providers ignore the `think`
option.

## How the settings are used

The values are read when a chat message is sent. `ChatView` builds a client
for the active provider per request:

```ts
const service = createChatService(this.plugin.settings);

const reply = await service.chat(this.history, {
	think: this.plugin.settings.ollamaThink,
});
```

Because the service is created per request, changing the provider, URL, key,
model, or thinking toggle takes effect on the next message without reopening
the chat view. Every request also carries the system prompt assembled by
`composeSystemPrompt()` (`src/ui/systemPrompt.ts`): the built-in
study-assistant identity, then the skill selected in the chat's skill
dropdown (view state, not saved), then `customInstructions`, then the
active-note context when the switch is on. See
[Skills.md](../guide/Skills.md) for skill details and
[AiProviders.md](../guide/AiProviders.md) for per-provider details.

## Testing the settings

1. Run `npm run build`.
2. Reload the plugin in Obsidian.
3. Open **Settings → Community plugins → Study Agent**.
4. With Ollama selected, confirm the model dropdown lists the models from
   `ollama list`; stop Ollama and click **Refresh** to confirm an error
   appears and the saved model stays selected.
5. Switch to a cloud provider, paste a key, click **Refresh**, and pick a
   model; confirm the chat works and the thinking switch disappears.
6. Toggle **Enable thinking** (Ollama) on/off and confirm it persists.
7. Upgrade an old `data.json` (with `ollamaBaseUrl`/`ollamaModel`) and confirm
   the Ollama provider keeps the saved URL and model.
8. Enter text in **Custom instructions**, reload Obsidian, confirm it
   persisted, and check that replies follow the extra instructions.
9. Add a custom skill, select it in the chat's skill dropdown, and confirm
   replies follow its prompt; edit it, then delete it (two clicks) and
   confirm the dropdown resets to **None**.

## See also

- `docs/guide/AiProviders.md` — provider list, privacy, and protocol notes.
- `docs/guide/Skills.md` — built-in and custom skills, how to use them.
- `docs/dev/OllamaService.md` — how the Ollama HTTP client works.
- `docs/dev/HowItWorks.md` — the full end-to-end flow.
