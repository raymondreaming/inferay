import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { PROJECT_ROOT } from "../../lib/path-utils.ts";
import { tryRoute } from "../../lib/route-helpers.ts";
import { userDataPath } from "../../lib/user-data.ts";
import {
	isAllowedLocalPath,
	isWithinDirectory,
	resolveRealAllowedLocalPath,
} from "../security.ts";

const IMAGE_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".ico",
]);

const TMP_DIR = userDataPath("uploads");
const MAX_TEMP_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_SERVED_FILE_BYTES = 20 * 1024 * 1024;
const MAX_REPO_DOC_BYTES = 256 * 1024;
const MAX_REPO_DOCS = 36;
const UPLOAD_THUMB_SIZE = 384;
const UPLOAD_THUMB_SUFFIX = ".thumb.jpg";

const ROOT_DOC_NAMES = new Set([
	"agents.md",
	"claude.md",
	"readme.md",
	"readme.mdx",
	"contributing.md",
	"changelog.md",
	"changes.md",
	"license.md",
	"security.md",
]);

type BunImagePipeline = {
	resize: (
		width: number,
		height?: number,
		options?: { fit?: "fill" | "inside"; withoutEnlargement?: boolean }
	) => BunImagePipeline;
	jpeg: (options?: {
		quality?: number;
		progressive?: boolean;
	}) => BunImagePipeline;
	write: (destination: string) => Promise<number>;
};

export function isRepoDocPath(relativePath: string): boolean {
	const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
	const name = basename(normalized);
	if (ROOT_DOC_NAMES.has(name)) return true;
	if (
		normalized.startsWith("docs/") &&
		[".md", ".mdx"].includes(extname(name))
	) {
		return true;
	}
	return false;
}

async function createUploadThumbnail(
	sourcePath: string
): Promise<string | null> {
	try {
		const thumbPath = `${sourcePath}${UPLOAD_THUMB_SUFFIX}`;
		await (Bun.file(sourcePath) as unknown as { image: () => BunImagePipeline })
			.image()
			.resize(UPLOAD_THUMB_SIZE, UPLOAD_THUMB_SIZE, {
				fit: "inside",
				withoutEnlargement: true,
			})
			.jpeg({ quality: 82 })
			.write(thumbPath);
		return thumbPath;
	} catch {
		return null;
	}
}

export async function listRepoDocs(cwd: string) {
	const resolvedCwd = resolve(cwd);
	if (!isAllowedLocalPath(resolvedCwd)) return null;

	const docs: Array<{
		name: string;
		cwd: string;
		path: string;
		relativePath: string;
		content: string;
		updatedAt: number;
		size: number;
	}> = [];
	const skip = new Set([
		".git",
		"node_modules",
		"build",
		"dist",
		"coverage",
		".next",
		".turbo",
	]);

	async function walk(dir: string, depth: number) {
		if (depth > 3 || docs.length >= MAX_REPO_DOCS) return;
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (docs.length >= MAX_REPO_DOCS) break;
			if (entry.name.startsWith(".") && entry.name !== ".github") continue;
			if (skip.has(entry.name)) continue;

			const full = join(dir, entry.name);
			if (!isWithinDirectory(full, resolvedCwd)) continue;
			const rel = relative(resolvedCwd, full);

			if (entry.isDirectory()) {
				if (depth === 0 || rel === "docs" || rel.startsWith("docs/")) {
					await walk(full, depth + 1);
				}
				continue;
			}

			if (!entry.isFile() || !isRepoDocPath(rel)) continue;
			try {
				const info = await stat(full);
				if (info.size > MAX_REPO_DOC_BYTES) continue;
				const content = await readFile(full, "utf8");
				docs.push({
					name: entry.name,
					cwd: resolvedCwd,
					path: full,
					relativePath: rel,
					content,
					updatedAt: info.mtimeMs,
					size: info.size,
				});
			} catch {}
		}
	}

	await walk(resolvedCwd, 0);
	return docs.toSorted((a, b) => {
		const aRank = a.relativePath.startsWith("docs/") ? 1 : 0;
		const bRank = b.relativePath.startsWith("docs/") ? 1 : 0;
		return aRank - bRank || a.relativePath.localeCompare(b.relativePath);
	});
}

export function fileRoutes() {
	return {
		"/api/files/search": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const cwd = url.searchParams.get("cwd") || PROJECT_ROOT;
				const query = (url.searchParams.get("q") || "").toLowerCase();
				const limit = Math.min(
					Number(url.searchParams.get("limit") || "20") || 20,
					50
				);

				const resolvedCwd = resolve(cwd);
				if (!isAllowedLocalPath(resolvedCwd)) {
					return Response.json({ error: "Invalid directory" }, { status: 400 });
				}

				const results: { name: string; path: string; isDir: boolean }[] = [];
				const seen = new Set<string>();
				const SKIP = new Set(["node_modules", "build", "dist"]);

				async function searchDir(dir: string, depth: number) {
					if (depth > 4 || results.length >= limit) return;
					try {
						const entries = await readdir(dir, { withFileTypes: true });
						for (const entry of entries) {
							if (results.length >= limit) break;
							if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
							const full = join(dir, entry.name);
							const rel = relative(resolvedCwd, full);
							if (seen.has(rel)) continue;
							if (
								!query ||
								entry.name.toLowerCase().includes(query) ||
								rel.toLowerCase().includes(query)
							) {
								seen.add(rel);
								results.push({
									name: entry.name,
									path: rel,
									isDir: entry.isDirectory(),
								});
							}
							if (entry.isDirectory() && depth < 4) {
								await searchDir(full, depth + 1);
							}
						}
					} catch {}
				}

				await searchDir(resolvedCwd, 0);
				return Response.json({ cwd: resolvedCwd, results });
			}),
		},

		"/api/upload-temp": {
			POST: tryRoute(async (req) => {
				const formData = await req.formData();
				const file = formData.get("file") as File | null;
				if (!file)
					return Response.json({ error: "No file provided" }, { status: 400 });
				if (file.size > MAX_TEMP_UPLOAD_BYTES) {
					return Response.json({ error: "File too large" }, { status: 413 });
				}
				const ext = file.name
					.substring(file.name.lastIndexOf("."))
					.toLowerCase();
				if (!IMAGE_EXTENSIONS.has(ext)) {
					return Response.json(
						{ error: "Unsupported file type" },
						{ status: 400 }
					);
				}
				await mkdir(TMP_DIR, { recursive: true });
				const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
				const filePath = resolve(TMP_DIR, `${Date.now()}-${safeName}`);
				if (!isWithinDirectory(filePath, TMP_DIR)) {
					return Response.json({ error: "Invalid file name" }, { status: 400 });
				}
				await Bun.write(filePath, file);
				const thumbnailPath = await createUploadThumbnail(filePath);
				return Response.json({ path: filePath, thumbnailPath });
			}),
		},

		"/api/images": {
			GET: tryRoute(async () => {
				await mkdir(TMP_DIR, { recursive: true });
				const entries = await readdir(TMP_DIR);
				const images: {
					name: string;
					path: string;
					timestamp: number;
					size: number;
				}[] = [];
				for (const entry of entries) {
					if (entry.endsWith(UPLOAD_THUMB_SUFFIX)) continue;
					const ext = entry.substring(entry.lastIndexOf(".")).toLowerCase();
					if (!IMAGE_EXTENSIONS.has(ext)) continue;
					const full = resolve(TMP_DIR, entry);
					const info = await stat(full);
					const dashIdx = entry.indexOf("-");
					const ts =
						dashIdx > 0 ? Number(entry.substring(0, dashIdx)) : info.mtimeMs;
					images.push({
						name: dashIdx > 0 ? entry.substring(dashIdx + 1) : entry,
						path: full,
						timestamp: ts,
						size: info.size,
					});
				}
				images.sort((a, b) => b.timestamp - a.timestamp);
				return Response.json({ images });
			}),
		},

		"/api/files/repo-docs": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const cwd = url.searchParams.get("cwd");
				if (!cwd) {
					return Response.json({ error: "No cwd provided" }, { status: 400 });
				}
				const docs = await listRepoDocs(cwd);
				if (!docs) {
					return Response.json({ error: "Invalid directory" }, { status: 400 });
				}
				return Response.json({ docs });
			}),
		},

		"/api/delete-temp": {
			DELETE: tryRoute(async (req) => {
				const url = new URL(req.url);
				const filePath = url.searchParams.get("path");
				if (!filePath)
					return Response.json({ error: "No path provided" }, { status: 400 });
				const resolved = resolve(filePath);
				if (!isWithinDirectory(resolved, TMP_DIR))
					return Response.json({ error: "Access denied" }, { status: 403 });
				const { unlink } = await import("node:fs/promises");
				await unlink(resolved);
				await unlink(`${resolved}${UPLOAD_THUMB_SUFFIX}`).catch(() => {});
				return Response.json({ ok: true });
			}),
		},

		"/api/file": {
			GET: tryRoute(async (req) => {
				const url = new URL(req.url);
				const filePath = url.searchParams.get("path");
				if (!filePath) {
					return Response.json({ error: "No path provided" }, { status: 400 });
				}

				const resolvedPath = await resolveRealAllowedLocalPath(filePath);
				if (!resolvedPath) {
					return Response.json({ error: "Access denied" }, { status: 403 });
				}
				if (
					!isWithinDirectory(resolvedPath, TMP_DIR) &&
					!isWithinDirectory(resolvedPath, PROJECT_ROOT)
				) {
					return Response.json({ error: "Access denied" }, { status: 403 });
				}
				const ext = resolvedPath
					.substring(resolvedPath.lastIndexOf("."))
					.toLowerCase();
				if (!IMAGE_EXTENSIONS.has(ext)) {
					return Response.json(
						{ error: "Unsupported file type" },
						{ status: 400 }
					);
				}

				if (!existsSync(resolvedPath)) {
					return Response.json({ error: "File not found" }, { status: 404 });
				}

				const file = Bun.file(resolvedPath);
				if (file.size > MAX_SERVED_FILE_BYTES) {
					return Response.json({ error: "File too large" }, { status: 413 });
				}
				return new Response(file, {
					headers: {
						"Content-Type": file.type || "application/octet-stream",
						"Cache-Control": "no-store",
					},
				});
			}),
		},
	};
}
