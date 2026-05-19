#!/usr/bin/env bun

import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const buildDir = process.env.ELECTROBUN_BUILD_DIR;

if (!buildDir) {
	process.exit(0);
}

const sourceDir = join(process.cwd(), "dist");
const sourceIndex = join(sourceDir, "index.html");

async function waitForFile(path: string, timeoutMs = 5000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await Bun.file(path).exists()) return true;
		await Bun.sleep(100);
	}
	return false;
}

try {
	if (!(await waitForFile(sourceIndex))) {
		throw new Error(`renderer index was not built at ${sourceIndex}`);
	}

	const entries = await readdir(buildDir, { withFileTypes: true });
	const apps = entries.filter(
		(entry) => entry.isDirectory() && entry.name.endsWith(".app")
	);

	for (const app of apps) {
		const viewsDir = join(
			buildDir,
			app.name,
			"Contents",
			"Resources",
			"app",
			"views"
		);
		await rm(viewsDir, { recursive: true, force: true });
		await cp(sourceDir, viewsDir, { recursive: true });
		console.log(`[views] copied renderer files -> ${app.name}`);
	}
} catch (error) {
	console.warn(
		`[views] could not copy renderer index: ${
			error instanceof Error ? error.message : String(error)
		}`
	);
}
