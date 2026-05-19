#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { cp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveExitCode } from "./watch-utils.ts";

const ROOT = process.cwd();
const watchTargets = [
	{ path: resolve(ROOT, "src"), recursive: true },
	{ path: resolve(ROOT, "scripts", "build-renderer.ts"), recursive: false },
].filter((target) => existsSync(target.path));

let debounce: ReturnType<typeof setTimeout> | null = null;
let building = false;
let pending = false;
const buildArgs = ["scripts/build-renderer.ts"];

if (process.argv.includes("--dev")) {
	buildArgs.push("--dev");
}

function isRendererFile(filename: string | null | undefined) {
	if (!filename) return false;
	return /\.(css|html|ts|tsx)$/.test(filename);
}

function runBuild(): Promise<number> {
	return new Promise((resolve) => {
		const proc = spawn("bun", buildArgs, {
			cwd: ROOT,
			stdio: "inherit",
		});
		proc.on("exit", resolveExitCode.bind(null, resolve));
		proc.on("error", resolve.bind(null, 1));
	});
}

async function syncDevViews() {
	const buildDir = resolve(ROOT, "build", "dev-macos-arm64");
	if (
		!existsSync(buildDir) ||
		!existsSync(resolve(ROOT, "dist", "index.html"))
	) {
		return;
	}

	const entries = await readdir(buildDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;
		const viewsDir = join(
			buildDir,
			entry.name,
			"Contents",
			"Resources",
			"app",
			"views"
		);
		await rm(viewsDir, { recursive: true, force: true });
		await cp(resolve(ROOT, "dist"), viewsDir, { recursive: true });
		console.log(`[views] synced renderer files -> ${entry.name}`);
	}
}

async function buildQueued() {
	if (building) {
		pending = true;
		return;
	}
	building = true;
	try {
		do {
			pending = false;
			if ((await runBuild()) === 0) {
				await syncDevViews();
			}
		} while (pending);
	} finally {
		building = false;
	}
}

for (const target of watchTargets) {
	watch(target.path, { recursive: target.recursive }, (_event, filename) => {
		if (!isRendererFile(filename)) return;
		if (debounce) clearTimeout(debounce);
		debounce = setTimeout(() => {
			void buildQueued();
		}, 120);
	});
}

process.stdin.resume();
