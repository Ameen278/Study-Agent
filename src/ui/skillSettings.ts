import { Setting } from 'obsidian';
import type ObsidianAgentPlugin from '../main';
import { allSkills, uniqueSkillId } from '../skills';
import { SkillModal } from './SkillModal';

/** Collapses a prompt to one preview line for a settings-row description. */
function preview(text: string, max: number): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Renders the **Custom skills** section of the settings tab: an **Add skill**
 * button plus one row (preview, **Edit**, **Delete**) per custom skill.
 *
 * Built-in skills (Study help, Revision, Summarize) live in code and are
 * listed in the chat's Skill dropdown; they are not editable here.
 *
 * @param containerEl Settings tab container to append to.
 * @param plugin      Plugin instance (settings + save access).
 * @param rerender    Re-renders the tab after add/edit/delete.
 */
export function renderSkillsSection(
	containerEl: HTMLElement,
	plugin: ObsidianAgentPlugin,
	rerender: () => void,
): void {
	new Setting(containerEl)
		.setName('Custom skills')
		.setDesc(
			"Extra skills shown in the chat's skill dropdown alongside the built-in study help, revision, and summarize skills. Selected skills are sent to your AI provider with each message.",
		)
		.addButton((button) =>
			button
				.setButtonText('Add skill')
				.setCta()
				.onClick(() => {
					new SkillModal(plugin.app, null, (draft) => {
						const id = uniqueSkillId(draft.name, allSkills(plugin.settings));
						plugin.settings.customSkills = [
							...plugin.settings.customSkills,
							{ id, name: draft.name, prompt: draft.prompt },
						];
						void plugin.saveSettings();
						rerender();
					}).open();
				}),
		);

	if (plugin.settings.customSkills.length === 0) {
		containerEl.createEl('p', {
			text: 'No custom skills yet — select add skill to create one.',
			cls: 'setting-item-description',
		});
		return;
	}

	for (const skill of plugin.settings.customSkills) {
		new Setting(containerEl)
			.setName(skill.name)
			.setDesc(preview(skill.prompt, 100))
			.addButton((button) =>
				button.setButtonText('Edit').onClick(() => {
					new SkillModal(plugin.app, skill, (draft) => {
						plugin.settings.customSkills =
							plugin.settings.customSkills.map((entry) =>
								entry.id === skill.id
									? { ...entry, name: draft.name, prompt: draft.prompt }
									: entry,
							);
						void plugin.saveSettings();
						rerender();
					}).open();
				}),
			)
			.addButton((button) => {
				// Two-step delete: first click arms the button, second deletes.
				let armed = false;
				button.setButtonText('Delete').onClick(async () => {
					if (!armed) {
						armed = true;
						button.setButtonText('Confirm delete');
						return;
					}
					plugin.settings.customSkills =
						plugin.settings.customSkills.filter(
							(entry) => entry.id !== skill.id,
						);
					await plugin.saveSettings();
					rerender();
				});
			});
	}
}
