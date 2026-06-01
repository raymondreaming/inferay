import { formatBytes } from "../../lib/format.ts";
import { readStoredJson, writeStoredJson } from "../../lib/stored-json.ts";
import type { ComposerContextBlock } from "../chat/agent-chat-shared.ts";
import {
	loadSessionLibrary,
	loadStoredChatPaneIds,
	loadStoredMessages,
} from "../chat/chat-session-store.ts";
import type {
	ArtifactEntry,
	ArtifactKind,
	DocumentArtifact,
	ImageArtifactSource,
	RepoDocArtifactSource,
} from "./types.ts";

export const DOCUMENT_ARTIFACTS_KEY = "inferay-document-artifacts";
export const DOCUMENT_ARTIFACTS_CHANGED_EVENT =
	"inferay:document-artifacts-changed";
const MAX_DOCUMENT_ARTIFACTS = 200;
const MAX_ARTIFACT_CONTEXT_CHARS = 12_000;
const IMAGE_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".ico",
]);

interface StoredImageMessage {
	createdAt?: unknown;
	content?: unknown;
	images?: unknown;
}

function compactPreview(value: string, max = 320): string {
	const text = value.replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function stableId(seed: string): string {
	let hash = 0;
	for (let index = 0; index < seed.length; index += 1) {
		hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
	}
	return hash.toString(36);
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function fileNameFromPath(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	const parts = normalized.split("/").filter(Boolean);
	return parts.length > 0 ? (parts[parts.length - 1] ?? path) : path;
}

function isImagePath(path: string): boolean {
	const clean = path.split("?")[0]?.split("#")[0] ?? path;
	const dotIndex = clean.lastIndexOf(".");
	if (dotIndex < 0) return false;
	return IMAGE_EXTENSIONS.has(clean.slice(dotIndex).toLowerCase());
}

function extractMessageImagePaths(message: StoredImageMessage): string[] {
	const paths = new Set<string>();
	if (Array.isArray(message.images)) {
		for (const item of message.images) {
			if (typeof item === "string" && isImagePath(item)) paths.add(item);
		}
	}
	if (typeof message.content === "string") {
		const marker = "Here are the images at these paths:\n";
		if (message.content.includes(marker)) {
			const sections = message.content.split(marker);
			const tail = sections[sections.length - 1] ?? "";
			for (const line of tail.split("\n")) {
				const path = line.trim();
				if (path && isImagePath(path)) paths.add(path);
			}
		}
	}
	return [...paths];
}

function chatImageArtifacts(): ArtifactEntry[] {
	const byPath = new Map<string, ArtifactEntry>();
	const sessions = loadSessionLibrary();
	const sessionByPaneId = new Map(
		sessions.map((session) => [session.paneId, session])
	);
	const paneIds = new Set([
		...sessions.map((session) => session.paneId),
		...loadStoredChatPaneIds(),
	]);
	for (const paneId of paneIds) {
		const session = sessionByPaneId.get(paneId);
		const messages = loadStoredMessages<StoredImageMessage>(paneId);
		let newestMessageWithImage: StoredImageMessage | undefined;
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (!message || extractMessageImagePaths(message).length === 0) continue;
			newestMessageWithImage = message;
			break;
		}
		const timestamp =
			session?.updatedAt ??
			(typeof newestMessageWithImage === "object" &&
			newestMessageWithImage !== null &&
			"createdAt" in newestMessageWithImage &&
			typeof newestMessageWithImage.createdAt === "number"
				? newestMessageWithImage.createdAt
				: Date.now());
		for (const message of messages) {
			for (const path of extractMessageImagePaths(message)) {
				if (byPath.has(path)) continue;
				byPath.set(path, {
					id: `chat-image:${path}`,
					kind: "image",
					title: fileNameFromPath(path),
					subtitle: session?.summary ?? session?.cwd ?? "Chat image",
					createdAt: session?.createdAt ?? timestamp,
					updatedAt: timestamp,
					size: null,
					path,
					content: path,
					preview: `Image referenced by ${session?.summary ?? paneId}`,
					deletable: false,
				});
			}
		}
	}
	return [...byPath.values()];
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
		typeof artifact.createdAt === "number" &&
		typeof artifact.updatedAt === "number"
	);
}

function imageArtifact(image: ImageArtifactSource): ArtifactEntry {
	return {
		id: `image:${image.path}`,
		kind: "image",
		title: image.name,
		subtitle: formatBytes(image.size),
		createdAt: image.timestamp,
		updatedAt: image.timestamp,
		size: image.size,
		path: image.path,
		content: image.path,
		preview: `Image artifact stored at ${image.path}`,
		deletable: true,
	};
}

function repoDocArtifact(doc: RepoDocArtifactSource): ArtifactEntry {
	return {
		id: `repo-doc:${doc.cwd}:${doc.relativePath}`,
		kind: "document",
		title: doc.relativePath,
		subtitle: doc.cwd,
		createdAt: doc.updatedAt,
		updatedAt: doc.updatedAt,
		size: doc.size,
		path: doc.path,
		content: doc.content,
		preview: compactPreview(doc.content),
		deletable: false,
	};
}

export function loadDocumentArtifacts(): DocumentArtifact[] {
	const stored = readStoredJson<unknown>(DOCUMENT_ARTIFACTS_KEY, []);
	if (!Array.isArray(stored)) return [];
	return [...stored]
		.filter(isDocumentArtifact)
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, MAX_DOCUMENT_ARTIFACTS);
}

function dispatchDocumentArtifactsChanged(): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new Event(DOCUMENT_ARTIFACTS_CHANGED_EVENT));
}

function saveDocumentArtifacts(
	artifacts: readonly DocumentArtifact[]
): boolean {
	const saved = writeStoredJson(
		DOCUMENT_ARTIFACTS_KEY,
		[...artifacts]
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.slice(0, MAX_DOCUMENT_ARTIFACTS)
	);
	if (saved) dispatchDocumentArtifactsChanged();
	return saved;
}

function documentArtifact(entry: DocumentArtifact): ArtifactEntry {
	return {
		id: `document:${entry.id}`,
		kind: "document",
		title: entry.title,
		subtitle: entry.subtitle,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
		size: entry.content.length,
		path: entry.projectPath ?? undefined,
		content: entry.content,
		preview: compactPreview(entry.content),
		deletable: true,
	};
}

export function createDocumentArtifact(input: {
	title: string;
	subtitle?: string;
	content: string;
	sourcePaneId?: string | null;
	sourceMessageId?: string | null;
	sourceRole?: string | null;
	projectPath?: string | null;
	createdAt?: number;
}): DocumentArtifact {
	const now = input.createdAt ?? Date.now();
	const title = input.title.trim() || "Saved agent note";
	const artifact: DocumentArtifact = {
		id: `doc-${stableId(
			[
				title,
				input.sourcePaneId,
				input.sourceMessageId,
				input.content.slice(0, 120),
				now,
			].join("|")
		)}`,
		title,
		subtitle: input.subtitle?.trim() || "Saved from chat",
		content: input.content.trim(),
		sourcePaneId: input.sourcePaneId ?? null,
		sourceMessageId: input.sourceMessageId ?? null,
		sourceRole: input.sourceRole ?? null,
		projectPath: input.projectPath ?? null,
		createdAt: now,
		updatedAt: now,
	};
	if (!saveDocumentArtifacts([artifact, ...loadDocumentArtifacts()])) {
		throw new Error("Failed to save document artifact.");
	}
	return artifact;
}

function deleteDocumentArtifact(id: string): void {
	if (
		!saveDocumentArtifacts(
			loadDocumentArtifacts().filter((artifact) => artifact.id !== id)
		)
	) {
		throw new Error("Failed to delete document artifact.");
	}
}

export function loadArtifactWorkspace(
	images: ImageArtifactSource[],
	repoDocs: RepoDocArtifactSource[] = []
): ArtifactEntry[] {
	const safeImages = Array.isArray(images) ? images : [];
	const safeRepoDocs = Array.isArray(repoDocs) ? repoDocs : [];
	const imagePaths = new Set(safeImages.map((image) => image.path));
	const documents = loadDocumentArtifacts().map(documentArtifact);
	const chatImages = chatImageArtifacts().filter(
		(artifact) => !imagePaths.has(artifact.path ?? "")
	);
	return [
		...safeImages.map(imageArtifact),
		...chatImages,
		...safeRepoDocs.map(repoDocArtifact),
		...documents,
	].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function filterArtifacts(
	artifacts: ArtifactEntry[],
	kind: ArtifactKind | "all",
	query: string
): ArtifactEntry[] {
	const needle = query.trim().toLowerCase();
	return artifacts.filter((artifact) => {
		if (kind !== "all" && artifact.kind !== kind) return false;
		if (!needle) return true;
		return [
			artifact.title,
			artifact.subtitle,
			artifact.preview,
			artifact.path ?? "",
		]
			.join("\n")
			.toLowerCase()
			.includes(needle);
	});
}

export function artifactContextBlock(
	artifact: ArtifactEntry
): Omit<ComposerContextBlock, "id" | "createdAt"> {
	const content = artifact.content.trim();
	const truncated =
		content.length > MAX_ARTIFACT_CONTEXT_CHARS
			? `${content.slice(0, MAX_ARTIFACT_CONTEXT_CHARS).trimEnd()}\n\n[Artifact truncated for composer context]`
			: content;
	return {
		source: "artifact",
		title: `Artifact: ${artifact.title}`,
		subtitle: `${artifact.kind} · ${artifact.subtitle}`,
		path: artifact.path,
		content: truncated,
	};
}

export function artifactPromptDraft(artifact: ArtifactEntry) {
	const commandBase = slug(artifact.title).slice(0, 28) || artifact.kind;
	const command = `artifact-${commandBase}-${stableId(artifact.id).slice(0, 5)}`;
	const content = artifact.content.trim();
	const bounded =
		content.length > MAX_ARTIFACT_CONTEXT_CHARS
			? `${content.slice(0, MAX_ARTIFACT_CONTEXT_CHARS).trimEnd()}\n\n[Artifact truncated for reusable prompt]`
			: content;
	return {
		name: `Use artifact: ${artifact.title}`,
		command,
		description: `Reusable prompt seeded from ${artifact.kind}: ${artifact.subtitle}`,
		promptTemplate: [
			`Use this saved Inferay artifact as durable context.`,
			`Artifact: ${artifact.title}`,
			`Kind: ${artifact.kind}`,
			artifact.path ? `Path: ${artifact.path}` : `Source: ${artifact.subtitle}`,
			"",
			"Artifact content:",
			"```",
			bounded,
			"```",
			"",
			"User task:",
			"{args}",
		].join("\n"),
		category: "custom",
		tags: ["artifact", artifact.kind],
	};
}

export function deleteLocalArtifact(id: string): void {
	const [kind, ...rest] = id.split(":");
	const artifactId = rest.join(":");
	if (kind === "document") deleteDocumentArtifact(artifactId);
}
