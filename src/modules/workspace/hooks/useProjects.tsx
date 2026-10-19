import type { ProjectFileCommand } from "@contracts";
import { readStoredValue, writeStoredValue } from "@shared/lib/native.tsx";
import { createMemo, createSignal } from "solid-js";
import {
	type Project,
	type ProjectWorkspaceView,
} from "../model/projectFiles.ts";
import { changeProject, loadProjects } from "../services/projectsApi.ts";

const [loaded, setLoaded] = createSignal<{
	projectId: string;
	catalog: ProjectWorkspaceView;
} | null>(null);
const catalog = () =>
	loaded()?.projectId === selectedId() ? loaded()!.catalog : null;
const [order, setOrder] = createSignal<string[]>([]);
const list = createMemo(() => {
	const ranks = new Map(order().map((id, index) => [id, index]));
	return [...(loaded()?.catalog.projects ?? [])].sort(
		(a, b) =>
			(ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
			(ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER),
	);
});
export function reorderProject(id: string, before: string | null) {
	const ids = list().map((p) => p.id);
	if (
		id === before ||
		!ids.includes(id) ||
		(before !== null && !ids.includes(before))
	)
		return;
	const next = ids.filter((value) => value !== id);
	next.splice(before === null ? next.length : next.indexOf(before), 0, id);
	setOrder(next);
	writeStoredValue("inferay-project-order", JSON.stringify(next));
}
const [selectedId, setSelectedId] = createSignal("");
const [repositoryPath, setRepositoryPath] = createSignal<string | null>(null);
const [view, setView] = createSignal("chat");
const [error, setError] = createSignal("");
const [busy, setBusy] = createSignal(false);
const locations = new Map<
	string,
	{ view: string; repositoryPath: string | null }
>();
let sequence = 0;
export const projects = {
	catalog,
	list,
	selectedId,
	view,
	error,
	busy,
	repositoryPath,
};
export function openProjectRepository(path: string) {
	setRepositoryPath(path);
	setView("code");
}
export function showProjectView(value: string) {
	setView(value);
}
export async function refreshProjects(id = selectedId()) {
	const ticket = ++sequence;
	try {
		const value = await loadProjects(id);
		if (ticket === sequence) {
			setLoaded({ projectId: id, catalog: value });
		}
	} catch (e) {
		if (ticket === sequence) setError(String(e));
	}
}
export async function selectProject(id: string) {
	setError("");
	if (id !== selectedId()) {
		locations.set(selectedId(), {
			view: view(),
			repositoryPath: repositoryPath(),
		});
		const previous = locations.get(id);
		setSelectedId(id);
		setView(previous?.view ?? "chat");
		setRepositoryPath(previous?.repositoryPath ?? null);
	}
	writeStoredValue("inferay-selected-project-id", id);
	await refreshProjects(id);
	if (
		selectedId() === id &&
		view() === "code" &&
		catalog() &&
		!catalog()!.repositoryPaths.includes(repositoryPath() ?? "")
	)
		setRepositoryPath(catalog()?.repositoryPaths[0] ?? null);
	if (!id && selectedId() === id) {
		const first = list().find((p) => !p.definition.archived);
		if (first) await selectProject(first.id);
	}
}
export async function initializeProjects() {
	try {
		const value: unknown = JSON.parse(
			readStoredValue("inferay-project-order") ?? "[]",
		);
		setOrder(
			Array.isArray(value)
				? value.filter((id): id is string => typeof id === "string")
				: [],
		);
	} catch {
		setOrder([]);
	}
	await selectProject(readStoredValue("inferay-selected-project-id") ?? "");
	if (
		selectedId() &&
		!catalog()?.projects.some(
			(p) => p.id === selectedId() && !p.definition.archived,
		)
	)
		await selectProject("");
}
export async function saveProjectCommand(command: ProjectFileCommand) {
	setBusy(true);
	setError("");
	try {
		const result = await changeProject(command);
		await refreshProjects();
		return result;
	} catch (e) {
		setError(String(e));
		throw e;
	} finally {
		setBusy(false);
	}
}

export async function addProjectRepository(project: Project, path: string) {
	await saveProjectCommand({
		type: "editRepository",
		projectId: project.id,
		expectedHash: project.sourceHash!,
		change: { kind: "add", path },
	});
}

/** Local command feedback stays with its surface, not the global catalog.
 * Repeated clicks cannot start another write while an action is pending.
 */
export function useProjectAction() {
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	let pending = false;
	async function run<T>(operation: () => Promise<T>): Promise<T | undefined> {
		if (pending) return;
		pending = true;
		setBusy(true);
		setError("");
		try {
			return await operation();
		} catch (error) {
			setError(String(error));
			return undefined;
		} finally {
			pending = false;
			setBusy(false);
		}
	}
	return { busy, error, setError, run };
}
