import { resolve } from "node:path";
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
import { tryRoute } from "../../lib/route-helpers.ts";
import { userDataPath } from "../../lib/user-data.ts";

const PROMPTS_FILE = userDataPath("prompts.json");
const REPO_PROMPTS_FILE = resolve(PROJECT_ROOT, "data/prompts.json");
const LEGACY_PROMPTS_FILE = resolve(PROJECT_ROOT, "src/data/prompts.json");

interface Prompt {
	_id: string;
	name: string;
	description: string;
	command: string;
	promptTemplate: string;
	category?: string;
	tags: string[];
	isBuiltIn: boolean;
	executionCount: number;
	lastUsed?: number;
	createdAt: number;
	updatedAt: number;
}

async function loadBundledPrompts(): Promise<Prompt[]> {
	const repoFile = Bun.file(REPO_PROMPTS_FILE);
	if (await repoFile.exists()) {
		return JSON.parse(await repoFile.text()) as Prompt[];
	}

	const legacyFile = Bun.file(LEGACY_PROMPTS_FILE);
	if (!(await legacyFile.exists())) return [];

	return JSON.parse(await legacyFile.text()) as Prompt[];
}

async function loadLocalPrompts(): Promise<Prompt[]> {
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
	const custom = Array.from(customById.values());

	return [...builtIns, ...custom];
}

async function loadPrompts(): Promise<Prompt[]> {
	const [bundled, local] = await Promise.all([
		loadBundledPrompts(),
		loadLocalPrompts(),
	]);
	return mergePrompts(bundled, local);
}

async function savePrompts(prompts: Prompt[]): Promise<void> {
	await atomicWriteJson(PROMPTS_FILE, prompts, 2);
}

let promptsWriteQueue: Promise<unknown> = Promise.resolve();

function withPromptsWrite<T>(fn: () => Promise<T>): Promise<T> {
	const next = promptsWriteQueue.then(fn, fn);
	promptsWriteQueue = next.catch(noop);
	return next;
}

export function promptRoutes() {
	return {
		"/api/prompts": {
			GET: tryRoute(async () => {
				const prompts = await loadPrompts();
				prompts.sort((a, b) => b.executionCount - a.executionCount);
				return Response.json(prompts);
			}),
			POST: tryRoute(async (req) => {
				const body = await req.json();
				return withPromptsWrite(async () => {
					const prompts = await loadPrompts();

					const existing = prompts.find(hasCommand.bind(null, body.command));
					if (existing) {
						return Response.json(
							{ error: `Command /${body.command} already exists` },
							{ status: 400 }
						);
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
					};

					prompts.push(prompt);
					await savePrompts(prompts);
					return Response.json(prompt);
				});
			}),
		},
	};
}

// These need to be handled in the fetch handler since Bun routes don't support path params
export function handlePromptRequest(
	req: Request
): Response | Promise<Response> | null {
	const url = new URL(req.url);
	const match = url.pathname.match(/^\/api\/prompts\/([^/]+)(\/usage)?$/);
	if (!match) return null;

	const id = match[1]!;
	const isUsage = !!match[2];

	if (isUsage && req.method === "POST") {
		return handleIncrementUsage(id);
	}
	if (req.method === "PUT") {
		return handleUpdate(id, req);
	}
	if (req.method === "DELETE") {
		return handleDelete(id);
	}
	return null;
}

async function handleUpdate(id: string, req: Request): Promise<Response> {
	const body = (await req.json()) as Partial<Prompt>;
	return withPromptsWrite(async () => {
		const prompts = await loadPrompts();

		const idx = prompts.findIndex(hasObjectId.bind(null, id));
		if (idx === -1) {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
		const current = prompts[idx]!;
		if (current.isBuiltIn) {
			return Response.json(
				{ error: "Cannot edit built-in prompts" },
				{ status: 400 }
			);
		}

		if (body.command && body.command !== current.command) {
			const conflict = prompts.find(
				(p) => p.command === body.command && lacksObjectId(id, p)
			);
			if (conflict) {
				return Response.json(
					{ error: `Command /${body.command} already exists` },
					{ status: 400 }
				);
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
		return Response.json(prompts[idx]);
	});
}

async function handleDelete(id: string): Promise<Response> {
	return withPromptsWrite(async () => {
		const prompts = await loadPrompts();
		const prompt = prompts.find(hasObjectId.bind(null, id));
		if (!prompt) {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
		if (prompt.isBuiltIn) {
			return Response.json(
				{ error: "Cannot delete built-in prompts" },
				{ status: 400 }
			);
		}
		await savePrompts(prompts.filter(lacksObjectId.bind(null, id)));
		return Response.json({ ok: true });
	});
}

async function handleIncrementUsage(id: string): Promise<Response> {
	return withPromptsWrite(async () => {
		const prompts = await loadPrompts();
		const idx = prompts.findIndex(hasObjectId.bind(null, id));
		if (idx === -1) {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
		const prompt = prompts[idx];
		if (!prompt) {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
		prompt.executionCount += 1;
		prompt.lastUsed = Date.now();
		await savePrompts(prompts);
		return Response.json({ ok: true });
	});
}
