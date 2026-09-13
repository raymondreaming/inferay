import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_DIR = join(homedir(), ".inferay");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

async function readConfig() {
	try {
		return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") {
			return {};
		}
		throw error;
	}
}

async function writeConfig(config) {
	await mkdir(dirname(CONFIG_PATH), { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

export async function getChannel() {
	const config = await readConfig();
	return config.channel || "stable";
}

export async function setChannel(channel) {
	const allowed = new Set(["stable", "nightly", "dev"]);
	if (!allowed.has(channel)) {
		throw new Error(
			`unknown channel "${channel}". Use stable, nightly, or dev.`,
		);
	}
	const config = await readConfig();
	config.channel = channel;
	await writeConfig(config);
}
