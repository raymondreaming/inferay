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
	let cursor: MarkdownCursor | undefined;
	let pending = 0;
	let disposed = false;
	let blocks: MdBlock[] = [];
	const release = () => {
		if (!pending && cursor && (disposed || !cursor.active())) {
			cursor.free();
			cursor = undefined;
			blocks = [];
		}
	};
	return {
		get active() {
			return !disposed && (cursor?.active() ?? false);
		},
		dispose() {
			disposed = true;
			blocks = [];
			release();
		},
		async prepare(
			text: string,
			streaming: boolean,
			chat: boolean,
			signal: AbortSignal,
		) {
			if (disposed) throw new Error("Markdown renderer was disposed");
			signal.throwIfAborted();
			const model = (cursor ??= new MarkdownCursor());
			const before = blocks;
			const attempt = model.begin(text, chat, streaming, crypto.randomUUID());
			pending++;
			try {
				let response = await send(JSON.parse(model.request(attempt)), signal);
				signal.throwIfAborted();
				const retry = model.retry(
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
					appendTarget: patch ? before[patch.start]?.type : undefined,
					blocks: Array.isArray(patch?.blocks) ? patch.blocks.length : null,
				};
				const result: { accepted: boolean; start: number } = JSON.parse(
					model.finish(attempt, response.status, JSON.stringify(metadata)),
				);
				const next = [
					...before.slice(0, result.start),
					...(patch?.appendCode === undefined
						? inserted
						: [
								{
									...before[result.start],
									content: before[result.start].content + patch.appendCode,
								},
							]),
				];
				if (result.accepted && !disposed) blocks = next;
				return { version: 1 as const, blocks: next };
			} catch (cause) {
				throw cause instanceof Error ? cause : new Error(String(cause));
			} finally {
				model.discard(attempt);
				pending--;
				release();
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
