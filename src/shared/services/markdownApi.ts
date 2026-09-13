import type { PreparedMarkdown } from "@contracts";
import { createMarkdownStreamClient } from "@shared/lib/markdownStream.ts";
import { sendJson } from "@shared/lib/native.tsx";

export const nativeMarkdownStream = () =>
	createMarkdownStreamClient((body, signal) =>
		sendJson("/api/native/markdown/stream", body, { signal }),
	);

export async function prepareNativeMarkdown(
	text: string,
	streaming: boolean,
	chat: boolean,
	signal: AbortSignal,
): Promise<PreparedMarkdown> {
	const response = await sendJson(
		"/api/native/markdown",
		{ text, streaming, chat },
		{ signal },
	);
	if (!response.ok) {
		const failure = await response.json().catch(() => null);
		throw new Error(
			failure?.error ?? `Markdown request failed (${response.status})`,
		);
	}
	const prepared: PreparedMarkdown = await response.json();
	if (prepared.version !== 1 || !Array.isArray(prepared.blocks))
		throw new Error("Unsupported Markdown response");
	return prepared;
}
