import type { ArtifactEntry } from "./types.ts";

export type ArtifactPreviewKind =
	| "image"
	| "markdown"
	| "json"
	| "html"
	| "pdf"
	| "text";

export interface ArtifactPreviewModel {
	kind: ArtifactPreviewKind;
	title: string;
	subtitle: string;
	content: string;
	lines: string[];
	tableRows: Array<{ key: string; value: string }>;
	imageUrl: string | null;
	pdfUrl: string | null;
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx", ".markdown"]);
const JSON_EXTENSIONS = new Set([".json", ".jsonc"]);

function extensionFor(pathOrTitle: string): string {
	const index = pathOrTitle.lastIndexOf(".");
	return index === -1 ? "" : pathOrTitle.slice(index).toLowerCase();
}

function previewKindForArtifact(artifact: ArtifactEntry): ArtifactPreviewKind {
	if (artifact.kind === "image" && artifact.path) return "image";
	const ext = extensionFor(artifact.path ?? artifact.title);
	if (ext === ".html" || ext === ".htm") return "html";
	if (ext === ".pdf") return "pdf";
	if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
	if (JSON_EXTENSIONS.has(ext)) return "json";
	if (/^\s*[{[]/.test(artifact.content)) return "json";
	if (/^\s*(<!doctype\s+html|<html[\s>])/i.test(artifact.content)) {
		return "html";
	}
	if (artifact.kind === "document") return "markdown";
	return "text";
}

function buildJsonRows(content: string): Array<{ key: string; value: string }> {
	try {
		const parsed = JSON.parse(content);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return Object.entries(parsed)
				.slice(0, 24)
				.map(([key, value]) => ({
					key,
					value:
						typeof value === "string" ? value : JSON.stringify(value, null, 2),
				}));
		}
		if (Array.isArray(parsed)) {
			return parsed.slice(0, 24).map((value, index) => ({
				key: String(index),
				value:
					typeof value === "string" ? value : JSON.stringify(value, null, 2),
			}));
		}
	} catch {}
	return [];
}

export function buildArtifactPreview(
	artifact: ArtifactEntry
): ArtifactPreviewModel {
	const kind = previewKindForArtifact(artifact);
	return {
		kind,
		title: artifact.title,
		subtitle: artifact.path ?? artifact.subtitle,
		content: artifact.content,
		lines: artifact.content.split(/\r?\n/).slice(0, 80),
		tableRows: kind === "json" ? buildJsonRows(artifact.content) : [],
		imageUrl:
			kind === "image" && artifact.path
				? `/api/file?path=${encodeURIComponent(artifact.path)}`
				: null,
		pdfUrl:
			kind === "pdf" && artifact.path
				? `/api/file?path=${encodeURIComponent(artifact.path)}`
				: null,
	};
}
