/**
 * Skill registry.
 *
 * A skill is a named instruction set that the user can activate from the
 * chat's Skill dropdown. When active, its prompt is injected into the system
 * request (between the assistant identity and the user's custom instructions)
 * so the model switches into a focused mode such as revision or summarizing.
 *
 * Three skills ship with the plugin ({@link BUILT_IN_SKILLS}); the user can
 * add their own in the settings tab, stored as `customSkills` in `data.json`.
 */

/** A skill definition: identifier, display name, and instruction text. */
export interface Skill {
	/** Stable id used in dropdown values and saved data (slug, e.g. `study-help`). */
	id: string;
	/** Label shown in the Skill dropdown and settings list. */
	name: string;
	/** Instructions injected into the system prompt while the skill is active. */
	prompt: string;
}

/** Just the settings fields the skill helpers need (avoids an import cycle). */
export interface SkillsSettingsLike {
	/** User-defined skills from settings; may contain malformed entries. */
	customSkills: Skill[];
}

/** Skills shipped with the plugin, in dropdown order. */
export const BUILT_IN_SKILLS: Skill[] = [
	{
		id: 'study-help',
		name: 'Study help',
		prompt: `Study-help mode:
- Explain concepts clearly at the user's level, starting from what their notes already cover.
- Solve problems step by step: state what is given, the approach, then each step with a short reason.
- Define jargon the first time you use it.
- Connect answers back to the user's notes or the active file when it is relevant.
- After each explanation, end with one short question that checks the user's understanding.`,
	},
	{
		id: 'revision',
		name: 'Revision',
		prompt: `Revision mode:
- Test the user with active recall: turn the material into questions instead of re-explaining it.
- Ask one question at a time and wait for the user's answer before moving on.
- After each answer, say whether it is correct, partially correct, or wrong, and give the missing piece in one or two sentences.
- Track which topics the user struggled with and revisit them before ending.
- Finish with a short recap: what to review next and three flashcard-style Q/A pairs for the weakest topics.`,
	},
	{
		id: 'summarize',
		name: 'Summarize',
		prompt: `Summarize mode:
- Produce a concise summary of the provided notes or question: key points as bullets, then key terms with one-line definitions.
- Respect a length limit when the user gives one (for example "10 bullets"); otherwise default to the shortest version that keeps all essential ideas.
- Use headings or a small table when the content has that structure; avoid prose paragraphs.
- Keep the user's terminology; do not add background that is not in the source.`,
	},
];

/** True when `value` looks like a usable {@link Skill}. */
export function isValidSkill(value: unknown): value is Skill {
	if (typeof value !== 'object' || value === null) return false;
	const skill = value as Partial<Skill>;
	return (
		typeof skill.id === 'string' &&
		skill.id.trim() !== '' &&
		typeof skill.name === 'string' &&
		skill.name.trim() !== '' &&
		typeof skill.prompt === 'string' &&
		skill.prompt.trim() !== ''
	);
}

/**
 * Built-in skills plus the user's valid custom skills.
 *
 * Malformed custom entries are skipped, and an id collision with an earlier
 * entry (for example a custom skill reusing `study-help`) is ignored so the
 * built-in always wins.
 */
export function allSkills(settings: SkillsSettingsLike): Skill[] {
	const skills: Skill[] = [...BUILT_IN_SKILLS];
	const seen = new Set(skills.map((skill) => skill.id));

	for (const skill of settings.customSkills ?? []) {
		if (!isValidSkill(skill) || seen.has(skill.id)) continue;
		seen.add(skill.id);
		skills.push(skill);
	}
	return skills;
}

/** Finds a skill by id (built-in or custom); `''` or unknown ids return `undefined`. */
export function findSkill(
	id: string | undefined,
	settings: SkillsSettingsLike,
): Skill | undefined {
	if (!id) return undefined;
	return allSkills(settings).find((skill) => skill.id === id);
}

/** Turns a skill name into a URL-safe slug; falls back to `skill`. */
function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || 'skill';
}

/**
 * Builds a unique id for a new custom skill from its name, appending
 * `-2`, `-3`, ... when the slug is already taken (built-ins included).
 */
export function uniqueSkillId(name: string, existing: Skill[]): string {
	const taken = new Set(existing.map((skill) => skill.id));
	const base = slugify(name);
	if (!taken.has(base)) return base;

	let suffix = 2;
	while (taken.has(`${base}-${suffix}`)) suffix += 1;
	return `${base}-${suffix}`;
}
