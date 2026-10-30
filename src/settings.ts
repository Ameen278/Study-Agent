import {
	App,
	ButtonComponent,
	DropdownComponent,
	PluginSettingTab,
	Setting,
} from 'obsidian';
import {
	PROVIDER_PRESETS,
	ChatError,
	createChatService,
	defaultProviderConfig,
	defaultProvidersRecord,
	isProviderId,
	presetLabel,
	type ProviderConfig,
	type ProviderId,
} from './ChatService';
import { isValidSkill, type Skill } from './skills';
import { renderSkillsSection } from './ui/skillSettings';
import type ObsidianAgentPlugin from './main';

export interface ObsidianAgentSettings {
	/** Currently selected provider id. */
	provider: ProviderId;
	/** Saved configuration for every provider (base URL, key, model). */
	providers: Record<ProviderId, ProviderConfig>;
	/** Whether Ollama thinking models may reason before replying. */
	ollamaThink: boolean;
	/** User-defined instructions appended to every request's system prompt. */
	customInstructions: string;
	/** User-defined skills shown in the chat's Skill dropdown. */
	customSkills: Skill[];
}

export const DEFAULT_SETTINGS: ObsidianAgentSettings = {
	provider: 'ollama',
	providers: defaultProvidersRecord(),
	ollamaThink: false,
	customInstructions: '',
	customSkills: [],
};

export class ObsidianAgentSettingTab extends PluginSettingTab {
	plugin: ObsidianAgentPlugin;

	constructor(app: App, plugin: ObsidianAgentPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const settings = this.plugin.settings;
		const preset = PROVIDER_PRESETS.find((p) => p.id === settings.provider);

		new Setting(containerEl)
			.setName('AI provider')
			.setDesc(
				'Ollama runs locally; nothing leaves your computer. Cloud providers send your messages (and active-file context if enabled) to their servers.',
			)
			.addDropdown((dropdown) => {
				for (const entry of PROVIDER_PRESETS) {
					dropdown.addOption(entry.id, entry.label);
				}
				dropdown.setValue(settings.provider);
				dropdown.onChange(async (value) => {
					if (!isProviderId(value)) return;
					this.plugin.settings.provider = value;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (preset) {
			containerEl.createEl('p', {
				text: preset.hint,
				cls: 'setting-item-description',
			});
		}

		const config = settings.providers[settings.provider];

		this.renderBaseUrlSetting(containerEl, config, preset);

		if (preset?.needsKey || settings.provider === 'custom') {
			this.renderApiKeySetting(containerEl, config);
		}

		this.renderModelSetting(containerEl, config);

		if (settings.provider === 'ollama') {
			this.renderThinkSetting(containerEl);
		}

		this.renderCustomInstructionsSetting(containerEl);

		renderSkillsSection(containerEl, this.plugin, () => this.display());
	}

	private renderBaseUrlSetting(
		containerEl: HTMLElement,
		config: ProviderConfig,
		preset: (typeof PROVIDER_PRESETS)[number] | undefined,
	): void {
		new Setting(containerEl)
			.setName('Base URL')
			.setDesc(
				preset?.defaultBaseUrl
					? `Server address. Default: ${preset.defaultBaseUrl}`
					: 'Server address of your OpenAI-compatible endpoint, e.g. http://localhost:1234/v1',
			)
			.addText((text) =>
				text
					.setPlaceholder(preset?.defaultBaseUrl ?? 'https://…')
					.setValue(config.baseUrl)
					.onChange(async (value) => {
						config.baseUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderApiKeySetting(
		containerEl: HTMLElement,
		config: ProviderConfig,
	): void {
		new Setting(containerEl)
			.setName('API key')
			.setDesc(
				'Stored in plain text in this vault’s plugin data.json — anyone with access to the file can use it. Leave empty for local servers that do not require a key.',
			)
			.addText((text) => {
				text.inputEl.type = 'password';
				text.setPlaceholder('Paste your API key…')
					.setValue(config.apiKey)
					.onChange(async (value) => {
						config.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});
	}

	private renderModelSetting(
		containerEl: HTMLElement,
		config: ProviderConfig,
	): void {
		let dropdown: DropdownComponent | undefined;
		let refreshButton: ButtonComponent | undefined;

		const setting = new Setting(containerEl)
			.setName('Model')
			.setDesc('Loading models...')
			.addDropdown((component) => {
				dropdown = component;
				component.onChange(async (value) => {
					config.model = value;
					await this.plugin.saveSettings();
				});
			})
			.addButton((component) => {
				refreshButton = component;
				component.setButtonText('Refresh').onClick(() => {
					if (dropdown) {
						void this.refreshModels(setting, dropdown, component, config);
					}
				});
			});

		if (dropdown) {
			void this.refreshModels(setting, dropdown, refreshButton, config);
		}
	}

	private async refreshModels(
		setting: Setting,
		dropdown: DropdownComponent,
		button: ButtonComponent | undefined,
		config: ProviderConfig,
	): Promise<void> {
		const current = config.model;
		const providerLabel = presetLabel(this.plugin.settings.provider);

		dropdown.setDisabled(true);
		button?.setDisabled(true);
		setting.setDesc('Loading models...');

		try {
			const service = createChatService(this.plugin.settings);
			const names = [...(await service.listModels())].sort((a, b) =>
				a.localeCompare(b),
			);

			dropdown.selectEl.empty();
			for (const name of names) {
				dropdown.addOption(name, name);
			}

			// Keep the saved model visible even when the list no longer
			// contains it (uninstalled locally, renamed upstream, ...).
			if (current && !names.includes(current)) {
				dropdown.addOption(current, `${current} (not listed)`);
			}

			if (current) {
				dropdown.setValue(current);
			} else if (names[0]) {
				dropdown.setValue(names[0]);
				config.model = names[0];
				await this.plugin.saveSettings();
			}

			setting.setDesc(
				names.length === 0
					? `No models found for ${providerLabel}.`
					: `${names.length} models available.`,
			);
		} catch (error) {
			setting.setDesc(
				error instanceof ChatError
					? error.message
					: `Could not load models from ${providerLabel}.`,
			);

			// Keep the saved model visible so the dropdown is never empty.
			if (current) {
				dropdown.selectEl.empty();
				dropdown.addOption(current, `${current} (not listed)`);
				dropdown.setValue(current);
			}
		} finally {
			dropdown.setDisabled(false);
			button?.setDisabled(false);
		}
	}

	private renderThinkSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Enable thinking')
			.setDesc(
				'Let thinking models reason before answering. Disable for faster, direct replies.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ollamaThink)
					.onChange(async (value) => {
						this.plugin.settings.ollamaThink = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderCustomInstructionsSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Custom instructions')
			.setDesc(
				'Extra instructions added to every request after the built-in study-assistant prompt. They are sent to your AI provider together with your messages.',
			)
			.addTextArea((text) => {
				text.inputEl.addClass('local-study-ai-custom-instructions');
				text
					.setPlaceholder(
						'E.g. Prefer short answers. Quiz me with 3 questions after each explanation.',
					)
					.setValue(this.plugin.settings.customInstructions)
					.onChange(async (value) => {
						this.plugin.settings.customInstructions = value;
						await this.plugin.saveSettings();
					});
			});
	}
}

/**
 * Merges freshly loaded `data.json` content with defaults, migrating legacy
 * flat fields (`ollamaBaseUrl`, `ollamaModel`) into the new per-provider
 * record when present.
 */
export function migrateSettings(
	raw: unknown,
): ObsidianAgentSettings {
	const source = (raw ?? {}) as Record<string, unknown>;
	const settings: ObsidianAgentSettings = {
		provider: 'ollama',
		providers: defaultProvidersRecord(),
		ollamaThink:
			typeof source.ollamaThink === 'boolean' ? source.ollamaThink : false,
		customInstructions:
			typeof source.customInstructions === 'string'
				? source.customInstructions
				: '',
		customSkills: Array.isArray(source.customSkills)
			? source.customSkills.filter(isValidSkill)
			: [],
	};

	if (isProviderId(source.provider)) {
		settings.provider = source.provider;
	}

	const savedProviders = source.providers as
		| Partial<Record<string, Partial<ProviderConfig>>>
		| undefined;
	if (savedProviders && typeof savedProviders === 'object') {
		for (const id of Object.keys(defaultProvidersRecord()) as ProviderId[]) {
			const saved = savedProviders[id];
			if (saved && typeof saved === 'object') {
				const fallback = defaultProviderConfig(id);
				settings.providers[id] = {
					baseUrl:
						typeof saved.baseUrl === 'string'
							? saved.baseUrl
							: fallback.baseUrl,
					apiKey:
						typeof saved.apiKey === 'string' ? saved.apiKey : fallback.apiKey,
					model: typeof saved.model === 'string' ? saved.model : fallback.model,
				};
			}
		}
	}

	// Legacy flat fields: adopt them for the Ollama entry so existing
	// setups keep their server URL and model after upgrading.
	const legacyBaseUrl =
		typeof source.ollamaBaseUrl === 'string' ? source.ollamaBaseUrl.trim() : '';
	const legacyModel =
		typeof source.ollamaModel === 'string' ? source.ollamaModel.trim() : '';
	if (legacyBaseUrl) settings.providers.ollama.baseUrl = legacyBaseUrl;
	if (legacyModel) settings.providers.ollama.model = legacyModel;

	return settings;
}
