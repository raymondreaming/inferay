import { resolve } from "node:path";
import type {
	AgentContextLayer,
	AgentContextMode,
	AgentContextUpdate,
	EffectiveAgentContext,
} from "../../features/agent-context/types.ts";
import type { Prompt } from "../../features/prompts/types.ts";
import { atomicWriteJson, readJson } from "../../lib/route-helpers.ts";
import { PROJECT_ROOT, userDataPath } from "../../lib/user-data.ts";

const CONTEXT_FILE = userDataPath("agent-context.json");
const LOCAL_SKILLS_FILE = userDataPath("prompts.json");
const BUNDLED_SKILLS_FILE = resolve(PROJECT_ROOT, "data/prompts.json");

interface AgentContextFile {
	global: AgentContextLayer;
	projects: Record<string, AgentContextLayer>;
	chats: Record<string, AgentContextLayer>;
}

const EMPTY_LAYER: AgentContextLayer = {
	instructions: "",
	mode: "inherit",
	updatedAt: 0,
};

function normalizeMode(value: unknown): AgentContextMode {
	return value === "replace" ? "replace" : "inherit";
}

function normalizeLayer(value: unknown): AgentContextLayer {
	if (!value || typeof value !== "object") return { ...EMPTY_LAYER };
	const layer = value as Partial<AgentContextLayer>;
	return {
		instructions:
			typeof layer.instructions === "string" ? layer.instructions : "",
		mode: normalizeMode(layer.mode),
		updatedAt: typeof layer.updatedAt === "number" ? layer.updatedAt : 0,
	};
}

async function loadContextFile(): Promise<AgentContextFile> {
	const stored = await readJson<Partial<AgentContextFile>>(CONTEXT_FILE, {});
	return {
		global: normalizeLayer(stored.global),
		projects:
			stored.projects && typeof stored.projects === "object"
				? Object.fromEntries(
						Object.entries(stored.projects).map(([key, value]) => [
							key,
							normalizeLayer(value),
						])
					)
				: {},
		chats:
			stored.chats && typeof stored.chats === "object"
				? Object.fromEntries(
						Object.entries(stored.chats).map(([key, value]) => [
							key,
							normalizeLayer(value),
						])
					)
				: {},
	};
}

function projectKey(cwd?: string): string | null {
	if (!cwd?.trim()) return null;
	return resolve(cwd.trim());
}

function composeLayers(
	global: AgentContextLayer,
	project: AgentContextLayer | null,
	chat: AgentContextLayer | null
): string {
	let parts = global.instructions.trim() ? [global.instructions.trim()] : [];
	for (const layer of [project, chat]) {
		if (!layer?.instructions.trim()) continue;
		parts =
			layer.mode === "replace"
				? [layer.instructions.trim()]
				: [...parts, layer.instructions.trim()];
	}
	return parts.join("\n\n");
}

export function createSkillManifest(skills: readonly Prompt[]): string {
	if (skills.length === 0) return "";
	return skills
		.map(
			(skill) =>
				`- ${skill.command}: ${skill.description || skill.name} (invoke with /${skill.command} or $${skill.command})`
		)
		.join("\n");
}

function activatedSkills(skills: readonly Prompt[], text: string) {
	const normalized = text.toLowerCase();
	return skills.flatMap((skill) => {
		const explicit =
			normalized.includes(`/${skill.command.toLowerCase()}`) ||
			normalized.includes(`$${skill.command.toLowerCase()}`);
		const triggerTerms = [skill.command.replaceAll("-", " "), skill.name]
			.map((value) => value.toLowerCase().trim())
			.filter((value) => value.length >= 4);
		const automatic = triggerTerms.some((term) => normalized.includes(term));
		return explicit || automatic
			? [
					{
						name: skill.name,
						command: skill.command,
						instructions: skill.promptTemplate,
					},
				]
			: [];
	});
}

async function loadSkillsForManifest(): Promise<Prompt[]> {
	const sources = await Promise.all(
		[BUNDLED_SKILLS_FILE, LOCAL_SKILLS_FILE].map(async (path) => {
			const file = Bun.file(path);
			if (!(await file.exists())) return [];
			try {
				return JSON.parse(await file.text()) as Prompt[];
			} catch {
				return [];
			}
		})
	);
	const byCommand = new Map<string, Prompt>();
	for (const skill of sources.flat()) byCommand.set(skill.command, skill);
	return [...byCommand.values()];
}

let writeQueue: Promise<unknown> = Promise.resolve();

export const AgentContextService = {
	async resolveForAgent(cwd?: string, paneId?: string, text = "") {
		const skills = await loadSkillsForManifest();
		const context = await this.resolve(cwd, paneId, skills);
		return { ...context, activatedSkills: activatedSkills(skills, text) };
	},
	async resolve(
		cwd: string | undefined,
		paneId: string | undefined,
		skills: readonly Prompt[] = []
	): Promise<EffectiveAgentContext> {
		const stored = await loadContextFile();
		const key = projectKey(cwd);
		const project = key ? (stored.projects[key] ?? null) : null;
		const chat = paneId ? (stored.chats[paneId] ?? null) : null;
		return {
			global: stored.global,
			project,
			chat,
			effectiveInstructions: composeLayers(stored.global, project, chat),
			scope: chat?.instructions.trim()
				? "chat"
				: project?.instructions.trim()
					? "project"
					: "global",
			skillCount: skills.length,
			skillManifest: createSkillManifest(skills),
			activatedSkills: [],
		};
	},

	async update(update: AgentContextUpdate): Promise<void> {
		const operation = writeQueue.then(async () => {
			const stored = await loadContextFile();
			const layer: AgentContextLayer = {
				instructions: update.instructions.trim(),
				mode: normalizeMode(update.mode),
				updatedAt: Date.now(),
			};
			if (update.scope === "global") stored.global = layer;
			else if (update.scope === "project") {
				const key = projectKey(update.cwd);
				if (!key) throw new Error("A project directory is required");
				if (layer.instructions) stored.projects[key] = layer;
				else delete stored.projects[key];
			} else {
				if (!update.paneId) throw new Error("A chat pane is required");
				if (layer.instructions) stored.chats[update.paneId] = layer;
				else delete stored.chats[update.paneId];
			}
			await atomicWriteJson(CONTEXT_FILE, stored, 2);
		});
		writeQueue = operation.catch(() => {});
		await operation;
	},
};
