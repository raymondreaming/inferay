import { readStoredJson, writeStoredJson } from "../../lib/stored-json.ts";
import {
	getAgentDefinition,
	loadDefaultChatSettings,
} from "../agents/agents.ts";
import type { StoredChatSession } from "../chat/chat-session-store.ts";
import type { SessionDetailModel } from "../chat/session-detail.ts";
import type { Prompt } from "../prompts/types.ts";
import type { QuickActionDraft, QuickActionProfile } from "./types.ts";

const QUICK_ACTIONS_STORAGE_KEY = "inferay-quick-actions";
const QUICK_ACTIONS_USAGE_KEY = "inferay-quick-actions-usage";

const BUILT_IN_CREATED_AT = 1776806400000;
const MAX_SESSION_ACTION_CONTEXT_CHARS = 12_000;

type QuickActionUsage = Record<
	string,
	{ lastUsed?: number; launchCount: number }
>;

type PromptActionSource = Pick<
	Prompt,
	"name" | "description" | "command" | "promptTemplate" | "category" | "tags"
>;

function builtInProfiles(): QuickActionProfile[] {
	const defaults = loadDefaultChatSettings();
	const codexModel = getAgentDefinition("codex").defaultModel;
	const claudeModel = getAgentDefinition("claude").defaultModel;
	return [
		{
			id: "builtin-review-changes",
			name: "Review current changes",
			description: "Open a reviewer agent with a focused diff-review brief.",
			agentKind: defaults.agentKind,
			model: defaults.model,
			reasoningLevel: defaults.reasoningLevel,
			cwd: "",
			prompt:
				"Review the current worktree changes. Prioritize bugs, regressions, security risks, and missing tests. Lead with findings and include exact file references.",
			tags: ["review", "git", "quality"],
			useWorktree: false,
			isBuiltIn: true,
			createdAt: BUILT_IN_CREATED_AT,
			updatedAt: BUILT_IN_CREATED_AT,
			launchCount: 0,
		},
		{
			id: "builtin-worktree-plan",
			name: "Plan isolated worktree",
			description: "Create a branch-safe plan before starting agent edits.",
			agentKind: "codex",
			model: codexModel,
			reasoningLevel: "high",
			cwd: "",
			prompt:
				"Create a worktree-safe implementation plan for this task. Include branch naming, files likely touched, verification gates, rollback plan, and merge/discard criteria.",
			tags: ["planning", "worktree", "safety"],
			useWorktree: true,
			isBuiltIn: true,
			createdAt: BUILT_IN_CREATED_AT,
			updatedAt: BUILT_IN_CREATED_AT,
			launchCount: 0,
		},
		{
			id: "builtin-ui-polish",
			name: "Frontend polish pass",
			description:
				"Send a frontend-focused agent brief with design QA baked in.",
			agentKind: "claude",
			model: claudeModel,
			cwd: "",
			prompt:
				"Perform a frontend polish pass. Check layout density, responsive behavior, empty/loading/error states, accessibility, text fit, and consistency with the existing design system. Implement focused fixes and verify them.",
			tags: ["frontend", "design", "qa"],
			useWorktree: false,
			isBuiltIn: true,
			createdAt: BUILT_IN_CREATED_AT,
			updatedAt: BUILT_IN_CREATED_AT,
			launchCount: 0,
		},
	];
}

function readCustomProfiles(): QuickActionProfile[] {
	const value = readStoredJson<unknown>(QUICK_ACTIONS_STORAGE_KEY, []);
	return Array.isArray(value)
		? value.filter(
				(profile): profile is QuickActionProfile =>
					typeof profile === "object" &&
					profile !== null &&
					typeof (profile as QuickActionProfile).id === "string"
			)
		: [];
}

function writeCustomProfiles(profiles: QuickActionProfile[]) {
	writeStoredJson(
		QUICK_ACTIONS_STORAGE_KEY,
		profiles.filter((profile) => !profile.isBuiltIn)
	);
}

function readUsage(): QuickActionUsage {
	const value = readStoredJson<unknown>(QUICK_ACTIONS_USAGE_KEY, {});
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as QuickActionUsage)
		: {};
}

function writeUsage(usage: QuickActionUsage) {
	writeStoredJson(QUICK_ACTIONS_USAGE_KEY, usage);
}

function withUsage(profile: QuickActionProfile, usage: QuickActionUsage) {
	const itemUsage = usage[profile.id];
	return {
		...profile,
		lastUsed: itemUsage?.lastUsed ?? profile.lastUsed,
		launchCount: itemUsage?.launchCount ?? profile.launchCount,
	};
}

export function loadQuickActions(): QuickActionProfile[] {
	const usage = readUsage();
	return [...builtInProfiles(), ...readCustomProfiles()]
		.map((profile) => withUsage(profile, usage))
		.sort((a, b) => {
			const usedDelta = (b.lastUsed ?? 0) - (a.lastUsed ?? 0);
			return (
				usedDelta ||
				b.launchCount - a.launchCount ||
				a.name.localeCompare(b.name)
			);
		});
}

export function saveQuickActionDraft(
	draft: QuickActionDraft,
	existingId?: string
): QuickActionProfile {
	const now = Date.now();
	const profiles = readCustomProfiles();
	const current = existingId
		? profiles.find((profile) => profile.id === existingId)
		: null;
	const profile: QuickActionProfile = {
		id: current?.id ?? `quick-${now}`,
		name: draft.name.trim(),
		description: draft.description.trim(),
		agentKind: draft.agentKind,
		model: draft.model,
		reasoningLevel: draft.reasoningLevel,
		cwd: draft.cwd.trim(),
		prompt: draft.prompt.trim(),
		tags: draft.tags,
		useWorktree: draft.useWorktree,
		createdAt: current?.createdAt ?? now,
		updatedAt: now,
		launchCount: current?.launchCount ?? 0,
	};
	writeCustomProfiles([
		profile,
		...profiles.filter((item) => item.id !== profile.id),
	]);
	return profile;
}

function quickActionDraftFromPrompt(
	prompt: PromptActionSource
): QuickActionDraft {
	const defaults = loadDefaultChatSettings();
	return {
		name: prompt.name,
		description:
			prompt.description || `Run /${prompt.command} as an agent launch.`,
		agentKind: defaults.agentKind,
		model: defaults.model,
		reasoningLevel: defaults.reasoningLevel,
		cwd: "",
		prompt: prompt.promptTemplate.replaceAll(
			"{args}",
			"[Add the specific task, files, logs, or constraints here]"
		),
		tags: [
			"prompt-action",
			`prompt:${prompt.command}`,
			prompt.category ?? "custom",
			...prompt.tags,
		].filter(Boolean),
		useWorktree: false,
	};
}

export function savePromptAsQuickAction(
	prompt: PromptActionSource
): QuickActionProfile {
	const sourceTag = `prompt:${prompt.command}`;
	const existing = readCustomProfiles().find((profile) =>
		profile.tags.includes(sourceTag)
	);
	return saveQuickActionDraft(quickActionDraftFromPrompt(prompt), existing?.id);
}

export function deletePromptQuickAction(command: string): number {
	const sourceTag = `prompt:${command}`;
	const profiles = readCustomProfiles();
	const removedIds = profiles
		.filter((profile) => profile.tags.includes(sourceTag))
		.map((profile) => profile.id);
	if (removedIds.length === 0) return 0;

	writeCustomProfiles(
		profiles.filter((profile) => !profile.tags.includes(sourceTag))
	);
	const usage = readUsage();
	for (const id of removedIds) delete usage[id];
	writeUsage(usage);
	return removedIds.length;
}

export function quickActionDraftFromSessionDetail(
	session: StoredChatSession,
	detail: SessionDetailModel
): QuickActionDraft {
	const defaults = loadDefaultChatSettings();
	const content = detail.transcriptArtifact.content.trim();
	const bounded =
		content.length > MAX_SESSION_ACTION_CONTEXT_CHARS
			? `${content.slice(0, MAX_SESSION_ACTION_CONTEXT_CHARS).trimEnd()}\n\n[Session transcript truncated for action prompt]`
			: content;
	const agentKind =
		session.agentKind === "claude" || session.agentKind === "codex"
			? session.agentKind
			: defaults.agentKind;
	return {
		name: `Continue session: ${detail.title}`,
		description: `Launch a follow-up agent from retained session ${session.paneId}.`,
		agentKind,
		model: session.model ?? defaults.model,
		reasoningLevel: session.reasoningLevel ?? defaults.reasoningLevel,
		cwd: session.cwd ?? "",
		prompt: [
			"Continue from this retained Inferay session.",
			"Use the transcript as context, identify the best next step, and ask before making risky changes.",
			"",
			bounded,
			"",
			"Follow-up task:",
			"[Describe the follow-up task, files, checks, or decision needed here]",
		].join("\n"),
		tags: [
			"session-action",
			`session:${session.paneId}`,
			`agent:${session.agentKind}`,
			detail.status,
		],
		useWorktree: false,
	};
}

export function saveSessionAsQuickAction(
	session: StoredChatSession,
	detail: SessionDetailModel
): QuickActionProfile {
	const sourceTag = `session:${session.paneId}`;
	const existing = readCustomProfiles().find((profile) =>
		profile.tags.includes(sourceTag)
	);
	return saveQuickActionDraft(
		quickActionDraftFromSessionDetail(session, detail),
		existing?.id
	);
}

export function markQuickActionLaunched(id: string) {
	const usage = readUsage();
	const current = usage[id];
	usage[id] = {
		lastUsed: Date.now(),
		launchCount: (current?.launchCount ?? 0) + 1,
	};
	writeUsage(usage);
}
