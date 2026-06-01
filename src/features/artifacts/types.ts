export type ArtifactKind = "image" | "document";

export interface ImageArtifactSource {
	name: string;
	path: string;
	timestamp: number;
	size: number;
}

export interface RepoDocArtifactSource {
	name: string;
	cwd: string;
	path: string;
	relativePath: string;
	content: string;
	updatedAt: number;
	size: number;
}

export interface ArtifactEntry {
	id: string;
	kind: ArtifactKind;
	title: string;
	subtitle: string;
	createdAt: number;
	updatedAt: number;
	size: number | null;
	path?: string;
	content: string;
	preview: string;
	deletable: boolean;
}

export interface DocumentArtifact {
	id: string;
	title: string;
	subtitle: string;
	content: string;
	contentPath?: string | null;
	sourcePaneId: string | null;
	sourceMessageId: string | null;
	sourceRole: string | null;
	projectPath: string | null;
	createdAt: number;
	updatedAt: number;
}
