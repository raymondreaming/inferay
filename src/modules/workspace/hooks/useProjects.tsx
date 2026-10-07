import type { ProjectCatalog, ProjectCommand } from "@contracts";
import { readStoredValue, writeStoredValue } from "@shared/lib/native.tsx";
import { createMemo, createSignal } from "solid-js";
import { changeProject, loadProjects } from "../services/projectsApi.ts";

const [loaded, setLoaded] = createSignal<{
	projectId: string;
	catalog: ProjectCatalog;
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
	setSelectedId(id);
	setRepositoryPath(null);
	writeStoredValue("inferay-selected-project-id", id);
	await refreshProjects(id);
	if (selectedId() === id && view() === "code")
		setRepositoryPath(catalog()?.repositoryPaths[0] ?? null);
	if (!id && selectedId() === id) {
		const first = list().find((p) => !p.archived);
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
		!catalog()?.projects.some((p) => p.id === selectedId() && !p.archived)
	)
		await selectProject("");
}
export async function saveProjectCommand(command: ProjectCommand) {
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
