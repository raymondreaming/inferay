import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import YAML from "yaml";

const CONFIG_PATH = resolve(import.meta.dir, "../../scripts/config.yaml");
const LOCAL_CONFIG_PATH = resolve(
	import.meta.dir,
	"../../scripts/config.local.yaml"
);

const DEFAULT_SEARCH_FOLDERS = [
	"~/Desktop",
	"~/Documents",
	"~/Projects",
	"~/Developer",
	"~/Code",
	"~/Work",
	"~/Sites",
	"~/repos",
	"~/src",
	"~/dev",
];

const DEFAULT_CONFIG: Record<string, unknown> = {
	openai: { api_key: "", model: "gpt-5.5" },
	anthropic: { api_key: "", model: "claude-opus-4-7" },
	build_agent: "claude",
	fal: { api_key: "" },
	paths: { template_dir: "../templates" },
	search_folders: DEFAULT_SEARCH_FOLDERS,
};

export class ConfigManager {
	private cache: Record<string, unknown> | null = null;

	async load(): Promise<Record<string, unknown>> {
		try {
			const baseFile = Bun.file(CONFIG_PATH);
			const localFile = Bun.file(LOCAL_CONFIG_PATH);

			let base = { ...DEFAULT_CONFIG };
			if (await baseFile.exists()) {
				const text = await baseFile.text();
				base = deepMergeRecords(
					base,
					(YAML.parse(text) ?? {}) as Record<string, unknown>
				);
			}

			if (await localFile.exists()) {
				const text = await localFile.text();
				base = deepMergeRecords(
					base,
					(YAML.parse(text) ?? {}) as Record<string, unknown>
				);
			}

			this.cache = base;
			return this.cache;
		} catch {
			this.cache = { ...DEFAULT_CONFIG };
			return this.cache;
		}
	}

	async update(
		updates: Record<string, unknown>
	): Promise<Record<string, unknown>> {
		const localOnlyKeys = new Set([
			"build_agent",
			"search_folders",
			"simulator_project_folders",
		]);
		const baseUpdates: Record<string, unknown> = {};
		const localUpdates: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(updates)) {
			if (localOnlyKeys.has(key)) {
				localUpdates[key] = value;
			} else {
				baseUpdates[key] = value;
			}
		}

		const current = await this.load();

		if (Object.keys(baseUpdates).length > 0) {
			await mkdir(dirname(CONFIG_PATH), { recursive: true });
			const baseFile = Bun.file(CONFIG_PATH);
			const baseCurrent = (await baseFile.exists())
				? (YAML.parse(await baseFile.text()) ?? {})
				: { ...DEFAULT_CONFIG };
			const mergedBase = deepMergeRecords(
				baseCurrent as Record<string, unknown>,
				baseUpdates
			);
			await Bun.write(CONFIG_PATH, YAML.stringify(mergedBase, { indent: 2 }));
		}

		if (Object.keys(localUpdates).length > 0) {
			await mkdir(dirname(LOCAL_CONFIG_PATH), { recursive: true });
			const localFile = Bun.file(LOCAL_CONFIG_PATH);
			const localCurrent = (await localFile.exists())
				? (YAML.parse(await localFile.text()) ?? {})
				: {};
			const mergedLocal = deepMergeRecords(
				localCurrent as Record<string, unknown>,
				localUpdates
			);
			await Bun.write(
				LOCAL_CONFIG_PATH,
				YAML.stringify(mergedLocal, { indent: 2 })
			);
		}

		const merged = deepMergeRecords(current, updates);
		this.cache = merged;
		return merged;
	}
}

export function deepMergeRecords(
	target: Record<string, unknown>,
	source: Record<string, unknown>
): Record<string, unknown> {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		if (
			source[key] &&
			typeof source[key] === "object" &&
			!Array.isArray(source[key]) &&
			target[key] &&
			typeof target[key] === "object" &&
			!Array.isArray(target[key])
		) {
			result[key] = deepMergeRecords(
				target[key] as Record<string, unknown>,
				source[key] as Record<string, unknown>
			);
		} else {
			result[key] = source[key];
		}
	}
	return result;
}
