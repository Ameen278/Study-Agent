import { App, Modal, Setting } from 'obsidian';

/** Name and prompt collected by {@link SkillModal} (the caller assigns the id). */
export interface SkillDraft {
	name: string;
	prompt: string;
}

/**
 * Modal for creating or editing a custom skill.
 *
 * `initial` is `null` for a new skill, or the skill being edited (its id is
 * kept by the caller's save handler). `onSave` receives the trimmed name and
 * prompt; empty fields show an inline error instead of saving.
 */
export class SkillModal extends Modal {
	private initial: { name: string; prompt: string } | null;
	private onSave: (draft: SkillDraft) => void;
	private nameValue: string;
	private promptValue: string;

	constructor(
		app: App,
		initial: { name: string; prompt: string } | null,
		onSave: (draft: SkillDraft) => void,
	) {
		super(app);
		this.initial = initial;
		this.onSave = onSave;
		this.nameValue = initial?.name ?? '';
		this.promptValue = initial?.prompt ?? '';
	}

	onOpen(): void {
		this.setTitle(this.initial ? 'Edit skill' : 'New skill');

		new Setting(this.contentEl)
			.setName('Name')
			.setDesc("Shown in the chat's skill dropdown.")
			.addText((text) =>
				text
					.setPlaceholder('E.g. Practice problems')
					.setValue(this.nameValue)
					.onChange((value) => {
						this.nameValue = value;
					}),
			);

		new Setting(this.contentEl)
			.setName('Prompt')
			.setDesc(
				'Instructions sent to the model while this skill is selected.',
			)
			.addTextArea((text) => {
				text.inputEl.addClass('local-study-ai-custom-instructions');
				text
					.setPlaceholder(
						'E.g. Give me one practice problem at a time and check each answer before moving on.',
					)
					.setValue(this.promptValue)
					.onChange((value) => {
						this.promptValue = value;
					});
			});

		const error = this.contentEl.createDiv({
			cls: 'setting-item-description local-study-ai-skill-error',
		});
		error.hide();

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText('Save skill')
					.setCta()
					.onClick(() => {
						const name = this.nameValue.trim();
						const prompt = this.promptValue.trim();
						if (!name || !prompt) {
							error.setText('Enter both a name and a prompt.');
							error.show();
							return;
						}
						this.onSave({ name, prompt });
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
