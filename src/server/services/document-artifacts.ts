import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentArtifact } from "../../features/artifacts/types.ts";
import { readJson, writeJson } from "../../lib/route-helpers.ts";
import { userDataPath } from "../../lib/user-data.ts";

const DOCUMENT_ARTIFACTS_DIR = userDataPath("document-artifacts");
const LEGACY_DOCUMENT_ARTIFACTS_PATH = userDataPath("document-artifacts.json");
const MAX_DOCUMENT_ARTIFACTS = 200;

type StoredDocumentArtifact = Omit<DocumentArtifact, "content"> & {
	contentPath: string;
};

function safeArtifactId(id: string): string {
	if (/^[a-zA-Z0-9._:-]+$/.test(id)) return id;
	throw new Error("Invalid artifact id");
}

function isDocumentArtifact(value: unknown): value is DocumentArtifact {
	if (!value || typeof value !== "object") return false;
	const artifact = value as Partial<DocumentArtifact>;
	return (
		typeof artifact.id === "string" &&
		typeof artifact.title === "string" &&
		typeof artifact.subtitle === "string" &&
		typeof artifact.content === "string" &&
		(artifact.sourcePaneId === null ||
			typeof artifact.sourcePaneId === "string") &&
		(artifact.sourceMessageId === null ||
			typeof artifact.sourceMessageId === "string") &&
		(artifact.sourceRole === null || typeof artifact.sourceRole === "string") &&
		(artifact.projectPath === null ||
			typeof artifact.projectPath === "string") &&
		(artifact.contentPath === undefined ||
			artifact.contentPath === null ||
			typeof artifact.contentPath === "string") &&
		typeof artifact.createdAt === "number" &&
		typeof artifact.updatedAt === "number"
	);
}

function isStoredDocumentArtifact(
	value: unknown
): value is StoredDocumentArtifact {
	if (!value || typeof value !== "object") return false;
	const artifact = value as Partial<StoredDocumentArtifact>;
	return (
		typeof artifact.id === "string" &&
		typeof artifact.title === "string" &&
		typeof artifact.subtitle === "string" &&
		typeof artifact.contentPath === "string" &&
		(artifact.sourcePaneId === null ||
			typeof artifact.sourcePaneId === "string") &&
		(artifact.sourceMessageId === null ||
			typeof artifact.sourceMessageId === "string") &&
		(artifact.sourceRole === null || typeof artifact.sourceRole === "string") &&
		(artifact.projectPath === null ||
			typeof artifact.projectPath === "string") &&
		typeof artifact.createdAt === "number" &&
		typeof artifact.updatedAt === "number"
	);
}

function normalizeIncomingArtifacts(value: unknown): DocumentArtifact[] {
	return Array.isArray(value)
		? value
				.filter(isDocumentArtifact)
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.slice(0, MAX_DOCUMENT_ARTIFACTS)
		: [];
}

function normalizeStoredArtifacts(value: unknown): StoredDocumentArtifact[] {
	return Array.isArray(value)
		? value
				.filter(isStoredDocumentArtifact)
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.slice(0, MAX_DOCUMENT_ARTIFACTS)
		: [];
}

async function readContent(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return "";
	}
}

export function createDocumentArtifactStore({
	dir = DOCUMENT_ARTIFACTS_DIR,
	legacyPath = LEGACY_DOCUMENT_ARTIFACTS_PATH,
}: {
	dir?: string;
	legacyPath?: string;
} = {}) {
	const indexPath = join(dir, "index.json");
	const contentPathFor = (id: string) => join(dir, `${safeArtifactId(id)}.md`);
	const withContent = async (
		artifact: StoredDocumentArtifact
	): Promise<DocumentArtifact> => ({
		...artifact,
		content: await readContent(artifact.contentPath),
	});

	const saveDocumentArtifacts = async (
		value: unknown
	): Promise<DocumentArtifact[]> => {
		const artifacts = normalizeIncomingArtifacts(value);
		await mkdir(dir, { recursive: true });
		const stored: StoredDocumentArtifact[] = [];
		for (const artifact of artifacts) {
			const contentPath = contentPathFor(artifact.id);
			await writeFile(contentPath, artifact.content, "utf8");
			stored.push({
				id: artifact.id,
				title: artifact.title,
				subtitle: artifact.subtitle,
				sourcePaneId: artifact.sourcePaneId,
				sourceMessageId: artifact.sourceMessageId,
				sourceRole: artifact.sourceRole,
				projectPath: artifact.projectPath,
				createdAt: artifact.createdAt,
				updatedAt: artifact.updatedAt,
				contentPath,
			});
		}
		await writeJson(indexPath, stored);
		return Promise.all(stored.map(withContent));
	};

	return {
		async loadDocumentArtifacts(): Promise<DocumentArtifact[]> {
			const stored = normalizeStoredArtifacts(
				await readJson<unknown>(indexPath, [])
			);
			if (stored.length > 0) return Promise.all(stored.map(withContent));
			const legacy = normalizeIncomingArtifacts(
				await readJson<unknown>(legacyPath, [])
			);
			if (legacy.length > 0) return saveDocumentArtifacts(legacy);
			return [];
		},
		saveDocumentArtifacts,
	};
}

const documentArtifactStore = createDocumentArtifactStore();

export async function loadDocumentArtifacts(): Promise<DocumentArtifact[]> {
	return documentArtifactStore.loadDocumentArtifacts();
}

export async function saveDocumentArtifacts(
	value: unknown
): Promise<DocumentArtifact[]> {
	return documentArtifactStore.saveDocumentArtifacts(value);
}
