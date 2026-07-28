#!/usr/bin/env bun

const vite = Bun.spawn({
	cmd: [
		"node",
		"node_modules/vite/bin/vite.js",
		"build",
		"--mode",
		process.argv.includes("--dev") ? "development" : "production",
	],
	stdout: "inherit",
	stderr: "inherit",
});

process.exit(await vite.exited);
