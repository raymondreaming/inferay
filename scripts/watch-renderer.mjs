import { spawn } from "node:child_process";
import process from "node:process";
import { watch } from "chokidar";

const watchedPaths = ["src", "public", "index.html", "vite.config.ts"];
let building = false;
let pending = true;

function buildRenderer() {
	return new Promise((resolve) => {
		const build = spawn("bun", ["run", "build:renderer"], {
			stdio: "inherit",
			env: process.env,
		});
		build.on("exit", (code) => resolve(code ?? 1));
	});
}

async function rebuild() {
	if (building) return;
	building = true;
	while (pending) {
		pending = false;
		const code = await buildRenderer();
		if (code !== 0)
			console.error(`[inferay-dev] renderer build failed (${code})`);
	}
	building = false;
}

const watcher = watch(watchedPaths, {
	ignoreInitial: true,
	awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 25 },
});
watcher.on("all", () => {
	pending = true;
	void rebuild();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, async () => {
		await watcher.close();
		process.exit(0);
	});
}

await rebuild();
console.log("[inferay-dev] watching renderer sources");
