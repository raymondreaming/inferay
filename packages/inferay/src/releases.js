import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";

const DEFAULT_REPO = "raymondreaming/inferay";

export function releaseRepo() {
	return process.env.INFERAY_RELEASE_REPO || DEFAULT_REPO;
}

export function releaseApiUrl(channel = "stable") {
	const repo = releaseRepo();
	if (process.env.INFERAY_RELEASE_URL) {
		return process.env.INFERAY_RELEASE_URL;
	}
	if (channel === "stable") {
		return `https://api.github.com/repos/${repo}/releases/latest`;
	}
	return `https://api.github.com/repos/${repo}/releases/tags/${channel}`;
}

export async function fetchRelease(channel = "stable") {
	const response = await fetch(releaseApiUrl(channel), {
		headers: {
			accept: "application/vnd.github+json",
			"user-agent": "inferay-cli",
		},
	});
	if (!response.ok) {
		throw new Error(`could not fetch release metadata (${response.status})`);
	}
	return response.json();
}

export function findAsset(release, platform) {
	const assets = Array.isArray(release.assets) ? release.assets : [];
	const target = platform.target;
	const preferred = [
		(asset) => asset.name?.includes(target) && asset.name?.endsWith(".dmg"),
		(asset) =>
			asset.name?.includes(platform.os) &&
			asset.name?.includes(platform.cpu) &&
			asset.name?.endsWith(".dmg"),
		(asset) => asset.name?.endsWith(".dmg"),
		(asset) => asset.name?.includes(target) && asset.name?.endsWith(".tar.zst"),
	];
	return preferred.map((matcher) => assets.find(matcher)).find(Boolean);
}

export async function downloadAsset(asset) {
	if (!asset?.browser_download_url) {
		throw new Error("release asset is missing a download URL");
	}
	const cacheDir = join(tmpdir(), "inferay-downloads");
	await mkdir(cacheDir, { recursive: true });
	const destination = join(cacheDir, asset.name);
	const response = await fetch(asset.browser_download_url, {
		headers: { "user-agent": "inferay-cli" },
	});
	if (!response.ok || !response.body) {
		throw new Error(`could not download ${asset.name} (${response.status})`);
	}
	await pipeline(response.body, createWriteStream(destination));
	return destination;
}
