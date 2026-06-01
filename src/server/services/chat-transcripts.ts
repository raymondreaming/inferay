import { rm } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJson } from "../../lib/route-helpers.ts";
import { userDataPath } from "../../lib/user-data.ts";

const TRANSCRIPT_DIR = userDataPath("chat-transcripts");

interface ChatTranscriptFile {
	messages: unknown[];
	updatedAt: number;
}

function safePaneId(paneId: string): string {
	if (/^[a-zA-Z0-9._:-]+$/.test(paneId)) return paneId;
	throw new Error("Invalid pane id");
}

function transcriptPath(paneId: string): string {
	return join(TRANSCRIPT_DIR, `${safePaneId(paneId)}.json`);
}

export async function loadChatTranscript(paneId: string): Promise<unknown[]> {
	const transcript = await readJson<ChatTranscriptFile>(
		transcriptPath(paneId),
		{ messages: [], updatedAt: 0 }
	);
	return Array.isArray(transcript.messages) ? transcript.messages : [];
}

export async function saveChatTranscript(
	paneId: string,
	messages: unknown[]
): Promise<void> {
	await writeJson(transcriptPath(paneId), {
		messages,
		updatedAt: Date.now(),
	});
}

export async function deleteChatTranscript(paneId: string): Promise<void> {
	await rm(transcriptPath(paneId), { force: true });
}
