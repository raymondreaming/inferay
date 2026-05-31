import {
	DEFAULT_CHAT_SETTINGS_KEY,
	type DefaultChatSettings,
	normalizeDefaultChatSettings,
} from "../../features/agents/agents.ts";
import { loadClientStorageEntries } from "./client-storage.ts";

export async function loadDefaultAgentRunSettings(): Promise<DefaultChatSettings> {
	try {
		const entries = await loadClientStorageEntries();
		const stored = entries[DEFAULT_CHAT_SETTINGS_KEY];
		return normalizeDefaultChatSettings(stored ? JSON.parse(stored) : null);
	} catch {
		return normalizeDefaultChatSettings(null);
	}
}
