import { resolve } from "node:path";
import type { Prompt } from "../../features/prompts/types.ts";
import { atomicWriteJson } from "../../lib/atomic-write.ts";
import {
	hasCommand,
	hasObjectId,
	isBuiltIn,
	isString,
	lacksObjectId,
	noop,
} from "../../lib/data.ts";
import { PROJECT_ROOT } from "../../lib/path-utils.ts";
import { userDataPath } from "../../lib/user-data.ts";

const PROMPTS_FILE = userDataPath("prompts.json");
const REPO_PROMPTS_FILE = resolve(PROJECT_ROOT, "data/prompts.json");

export type PromptServiceResult<T> =
	| { ok: true; value: T }
	| { ok: false; status: number; error: string };

async function loadBundledPrompts(): Promise<Prompt[]> {
	const repoFile = Bun.file(REPO_PROMPTS_FILE);
	if (!(await repoFile.exists())) return [];
	return JSON.parse(await repoFile.text()) as Prompt[];
}

export async function loadLocalPrompts(): Promise<Prompt[]> {
	const file = Bun.file(PROMPTS_FILE);
	if (!(await file.exists())) return [];
	return JSON.parse(await file.text()) as Prompt[];
}

export function mergePrompts(bundled: Prompt[], local: Prompt[]): Prompt[] {
	const localById = new Map(local.map((prompt) => [prompt._id, prompt]));
	const localBuiltInByCommand = new Map(
		local.filter(isBuiltIn).map((prompt) => [prompt.command, prompt])
	);
	const bundledBuiltIns = bundled.filter(isBuiltIn);
	const builtInIds = new Set(bundledBuiltIns.map((prompt) => prompt._id));
	const builtInCommands = new Set(
		bundledBuiltIns.map((prompt) => prompt.command)
	);

	const builtIns = bundledBuiltIns.map((prompt) => {
		const localPrompt =
			localById.get(prompt._id) ?? localBuiltInByCommand.get(prompt.command);
		return {
			...prompt,
			isBuiltIn: true,
			executionCount: localPrompt?.executionCount ?? prompt.executionCount ?? 0,
			lastUsed: localPrompt?.lastUsed ?? prompt.lastUsed,
		};
	});
	const customById = new Map<string, Prompt>();
	for (const prompt of bundled) {
		if (
			!prompt.isBuiltIn &&
			!builtInIds.has(prompt._id) &&
			!builtInCommands.has(prompt.command)
		) {
			customById.set(prompt._id, prompt);
		}
	}
	for (const prompt of local) {
		if (
			!prompt.isBuiltIn &&
			!builtInIds.has(prompt._id) &&
			!builtInCommands.has(prompt.command)
		) {
			customById.set(prompt._id, prompt);
		}
	}

	return [...builtIns, ...Array.from(customById.values())];
}

export async function loadPrompts(): Promise<Prompt[]> {
	const [bundled, local] = await Promise.all([
		loadBundledPrompts(),
		loadLocalPrompts(),
	]);
	return mergePrompts(bundled, local);
}

export async function listPromptsByUsage(): Promise<Prompt[]> {
	const prompts = await loadPrompts();
	return prompts.toSorted((a, b) => b.executionCount - a.executionCount);
}

export async function savePrompts(prompts: Prompt[]): Promise<void> {
	await atomicWriteJson(PROMPTS_FILE, prompts, 2);
}

let promptsWriteQueue: Promise<unknown> = Promise.resolve();

function withPromptsWrite<T>(fn: () => Promise<T>): Promise<T> {
	const next = promptsWriteQueue.then(fn, fn);
	promptsWriteQueue = next.catch(noop);
	return next;
}

export function promptError(
	status: number,
	error: string
): PromptServiceResult<never> {
	return { ok: false, status, error };
}

export async function createPrompt(
	body: Partial<Prompt>
): Promise<PromptServiceResult<Prompt>> {
	return withPromptsWrite(async () => {
		const prompts = await loadPrompts();

		const existing = prompts.find(hasCommand.bind(null, body.command));
		if (existing) {
			return promptError(400, `Command /${body.command} already exists`);
		}

		const now = Date.now();
		const prompt: Prompt = {
			_id: `custom-${now}`,
			name: body.name,
			description: body.description || body.name,
			command: body.command,
			promptTemplate: body.promptTemplate,
			category: body.category || "custom",
			tags: body.tags || [],
			isBuiltIn: false,
			executionCount: 0,
			createdAt: now,
			updatedAt: now,
		} as Prompt;

		prompts.push(prompt);
		await savePrompts(prompts);
		return { ok: true, value: prompt };
	});
}

export async function updatePrompt(
	id: string,
	body: Partial<Prompt>
): Promise<PromptServiceResult<Prompt>> {
	return withPromptsWrite(async () => {
		const prompts = await loadPrompts();

		const idx = prompts.findIndex(hasObjectId.bind(null, id));
		if (idx === -1) return promptError(404, "Not found");

		const current = prompts[idx]!;
		if (current.isBuiltIn) {
			return promptError(400, "Cannot edit built-in prompts");
		}

		if (body.command && body.command !== current.command) {
			const conflict = prompts.find(
				(prompt) => prompt.command === body.command && lacksObjectId(id, prompt)
			);
			if (conflict) {
				return promptError(400, `Command /${body.command} already exists`);
			}
		}

		prompts[idx] = {
			...current,
			name: typeof body.name === "string" ? body.name : current.name,
			description:
				typeof body.description === "string"
					? body.description
					: current.description,
			command:
				typeof body.command === "string" ? body.command : current.command,
			promptTemplate:
				typeof body.promptTemplate === "string"
					? body.promptTemplate
					: current.promptTemplate,
			category:
				typeof body.category === "string" ? body.category : current.category,
			tags: Array.isArray(body.tags)
				? body.tags.filter(isString)
				: current.tags,
			updatedAt: Date.now(),
		};
		await savePrompts(prompts);
		return { ok: true, value: prompts[idx] };
	});
}

export async function deletePrompt(
	id: string
): Promise<PromptServiceResult<{ ok: true }>> {
	return withPromptsWrite(async () => {
		const prompts = await loadPrompts();
		const prompt = prompts.find(hasObjectId.bind(null, id));
		if (!prompt) return promptError(404, "Not found");
		if (prompt.isBuiltIn) {
			return promptError(400, "Cannot delete built-in prompts");
		}

		await savePrompts(prompts.filter(lacksObjectId.bind(null, id)));
		return { ok: true, value: { ok: true } };
	});
}

export async function incrementPromptUsage(
	id: string
): Promise<PromptServiceResult<{ ok: true }>> {
	return withPromptsWrite(async () => {
		const prompts = await loadPrompts();
		const idx = prompts.findIndex(hasObjectId.bind(null, id));
		if (idx === -1) return promptError(404, "Not found");

		const prompt = prompts[idx];
		if (!prompt) return promptError(404, "Not found");

		prompt.executionCount += 1;
		prompt.lastUsed = Date.now();
		await savePrompts(prompts);
		return { ok: true, value: { ok: true } };
	});
}
