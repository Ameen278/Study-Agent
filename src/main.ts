import { Plugin } from 'obsidian';
import { ChatView, VIEW_TYPE_CHAT } from './ui/ChatView';
import {
	migrateSettings,
	ObsidianAgentSettings,
	ObsidianAgentSettingTab,
} from './settings';

export default class ObsidianAgentPlugin extends Plugin {
	settings!: ObsidianAgentSettings;

	/** Called after settings are saved, so open views can refresh their UI. */
	private settingsListeners = new Set<() => void>();

	private async activateChatView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];

		if (!leaf) {
			const newLeaf = workspace.getRightLeaf(false);
			if (!newLeaf) return;

			await newLeaf.setViewState({
				type: VIEW_TYPE_CHAT,
				active: true,
			});
			leaf = newLeaf;
		}

		await workspace.revealLeaf(leaf);
	}

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new ObsidianAgentSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_CHAT,
			(leaf) => new ChatView(leaf, this),
		);

		this.addRibbonIcon('bot', 'Open local study AI', () => {
			void this.activateChatView();
		});

		this.addCommand({
			id: 'open-local-study-ai',
			name: 'Open local study AI',
			callback: () => {
				void this.activateChatView();
			},
		});
	}

	async loadSettings() {
		this.settings = migrateSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.settingsListeners.forEach((listener) => listener());
	}

	/**
	 * Subscribes to settings changes. The callback runs after every
	 * `saveSettings()`. Returns an unsubscribe function; callers must invoke
	 * it when their view closes so no stale listeners accumulate.
	 */
	registerSettingsListener(listener: () => void): () => void {
		this.settingsListeners.add(listener);
		return () => this.settingsListeners.delete(listener);
	}
}
