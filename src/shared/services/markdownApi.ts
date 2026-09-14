import type { PreparedMarkdown } from "@contracts";
import { createMarkdownStreamClient } from "@shared/lib/markdownStream.ts";
import { postJson, sendJson } from "@shared/lib/native.tsx";

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
	const prepared = await postJson<PreparedMarkdown>(
		"/api/native/markdown",
		{ text, streaming, chat },
		{ signal },
		{
			server: true,
			message: (status) => `Markdown request failed (${status})`,
		},
	);
	if (prepared.version !== 1 || !Array.isArray(prepared.blocks))
		throw new Error("Unsupported Markdown response");
	return prepared;
}
