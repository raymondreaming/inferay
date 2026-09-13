import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const required = readFileSync(
	new URL("../.bun-version", import.meta.url),
	"utf8",
).trim();
let actual = process.versions.bun;
if (!actual) {
	try {
		actual = execFileSync("bun", ["--version"], { encoding: "utf8" }).trim();
	} catch {
		actual = "not installed";
	}
}
if (actual !== required) {
	console.error(
		`Inferay development requires Bun ${required}; found ${actual}. Switch to Bun ${required} and retry.`,
	);
	process.exit(1);
}
