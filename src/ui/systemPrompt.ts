import type { Skill } from '../skills';

/**
 * Built-in assistant identity and system-prompt assembly.
 *
 * Every request carries {@link STUDY_ASSISTANT_PROMPT} so the model always
 * knows it is a study assistant inside the user's Obsidian vault — even when
 * no skill, custom instructions, or active-note context are set.
 */

/**
 * Always-on identity prompt.
 *
 * Sent with every chat request, ahead of any skill, custom instructions,
 * and active-note context.
 */
export const STUDY_ASSISTANT_PROMPT = `You are a study assistant inside the user's Obsidian vault.

Instructions:
- Help the user learn from their notes: explain concepts, summarize, answer questions, quiz them, and suggest improvements to their notes.
- When file content or other vault material is provided, treat it as the primary source of truth.
- If you do not have enough information, say so clearly instead of inventing details.
- Answer in the language the user writes in.
- Use clear, well-structured Markdown when it helps readability.`;

/** Optional pieces of the system prompt for one request. */
export interface SystemPromptParts {
	/** Skill selected in the chat's Skill dropdown, if any. */
	skill?: Skill;
	/** User-defined extra instructions from settings. */
	customInstructions?: string;
	/** Active-note context from `buildActiveFileContext`. */
	activeFileContext?: string;
}

/**
 * Assembles the full system prompt for one request.
 *
 * Order: built-in identity, then the active skill (a focused mode such as
 * Revision), then the user's custom instructions (their own words win over
 * skill text), and finally the active-note context block. Missing parts are
 * skipped, so the result always contains at least
 * {@link STUDY_ASSISTANT_PROMPT}.
 */
export function composeSystemPrompt(parts: SystemPromptParts = {}): string {
	const sections: string[] = [STUDY_ASSISTANT_PROMPT];

	if (parts.skill?.prompt.trim()) {
		sections.push(
			`The user selected the "${parts.skill.name}" skill. Follow its instructions for this request:\n\n${parts.skill.prompt.trim()}`,
		);
	}

	const custom = parts.customInstructions?.trim();
	if (custom) sections.push(custom);

	const context = parts.activeFileContext?.trim();
	if (context) sections.push(context);

	return sections.join('\n\n');
}
