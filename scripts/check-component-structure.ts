import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = join(import.meta.dir, "..", "src");

function filesIn(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? filesIn(path) : [path];
	});
}

const errors: string[] = [];
const folders = new Set<string>();
for (const file of filesIn(root)) {
	const name = relative(root, file);
	if (!file.endsWith(".tsx")) continue;
	const source = readFileSync(file, "utf8");
	const componentFile =
		name.includes("/components/") || name.startsWith("shared/ui/");
	if (componentFile) {
		const directory = dirname(file);
		folders.add(directory);
		if (!existsSync(join(directory, "index.tsx"))) {
			errors.push(`${name}: component folder must contain index.tsx`);
		}
	}
	if (/stylex\.(?:create|keyframes)\s*\(/.test(source)) {
		errors.push(
			`${name}: move style definitions to the component folder's styles.ts`,
		);
	}
	if (/\bstyle=\{\s*\{/.test(source)) {
		errors.push(`${name}: move inline style objects to styles.ts`);
	}
	if (
		!componentFile &&
		/^(?:export\s+)?function\s+[A-Z]\w*\s*\(/m.test(source)
	) {
		errors.push(
			`${name}: move component definitions into a named component folder`,
		);
	}
}

if (errors.length) {
	console.error(errors.join("\n"));
	process.exitCode = 1;
} else {
	console.log(
		`Component structure passed: ${folders.size} folders with index.tsx; local styles belong in styles.ts.`,
	);
}
