import type {
	MarkdownPatch,
	MarkdownStreamRequest,
	MdBlock,
	PreparedMarkdown,
} from "@contracts";
import { MarkdownCursor, postJson, sendJson } from "@shared/lib/native.tsx";

export function nativeMarkdownStream(
	send: (
		body: MarkdownStreamRequest,
		signal: AbortSignal,
	) => Promise<Response> = (body, signal) =>
		sendJson("/api/native/markdown/stream", body, { signal }),
) {
	const cursor = new MarkdownCursor();
	let blocks: MdBlock[] = [];
	return {
		get active() {
			return cursor.active();
		},
		async prepare(
			text: string,
			streaming: boolean,
			chat: boolean,
			signal: AbortSignal,
		) {
			signal.throwIfAborted();
			const before = blocks;
			const attempt = cursor.begin(text, chat, streaming, crypto.randomUUID());
			try {
				let response = await send(JSON.parse(cursor.request(attempt)), signal);
				signal.throwIfAborted();
				const retry = cursor.retry(
					attempt,
					response.status,
					crypto.randomUUID(),
				);
				if (retry) {
					response = await send(JSON.parse(retry), signal);
					signal.throwIfAborted();
				}
				const patch: MarkdownPatch | null = await response
					.json()
					.catch(() => null);
				signal.throwIfAborted();
				const inserted = Array.isArray(patch?.blocks) ? patch.blocks : [];
				const metadata = {
					...patch,
					blocks: Array.isArray(patch?.blocks) ? patch.blocks.length : null,
				};
				const result: { accepted: boolean; start: number } = JSON.parse(
					cursor.finish(attempt, response.status, JSON.stringify(metadata)),
				);
				const next = [...before.slice(0, result.start), ...inserted];
				if (result.accepted) blocks = next;
				return { version: 1 as const, blocks: next };
			} catch (cause) {
				throw cause instanceof Error ? cause : new Error(String(cause));
			} finally {
				cursor.discard(attempt);
			}
		},
	};
}

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
