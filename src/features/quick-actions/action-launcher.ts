import type { QuickActionProfile } from "./types.ts";

export function filterActionLauncherProfiles(
	profiles: readonly QuickActionProfile[],
	query: string
): QuickActionProfile[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...profiles];
	return profiles.filter((profile) =>
		[
			profile.name,
			profile.description,
			profile.agentKind,
			profile.model,
			profile.cwd,
			profile.prompt,
			profile.useWorktree ? "worktree" : "",
			...profile.tags,
		]
			.join(" ")
			.toLowerCase()
			.includes(needle)
	);
}

export function moveLauncherIndex(
	current: number,
	direction: 1 | -1,
	length: number
): number {
	if (length <= 0) return 0;
	return (current + direction + length) % length;
}
