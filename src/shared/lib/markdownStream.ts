import type { MarkdownPatch } from "../../../build/presentation/contracts/MarkdownPatch.ts";
import type { MdBlock } from "../../../build/presentation/contracts/MdBlock.ts";

type StreamRequest = {
	streamId: string;
	baseRevision?: number;
	text?: string;
	append?: string;
	streaming: boolean;
	chat: boolean;
};
type Snapshot = {
	id: string;
	text: string;
	chat: boolean;
	revision: number;
	blocks: MdBlock[];
};

/** Owns a disposable parser cursor; the caller still owns query cancellation. */
export function createMarkdownStreamClient(
	send: (request: StreamRequest, signal: AbortSignal) => Promise<Response>,
) {
	let snapshot: Snapshot | undefined;
	let attempt = 0;
	return {
		get active() {
			return snapshot !== undefined;
		},
		async prepare(
			text: string,
			streaming: boolean,
			chat: boolean,
			signal: AbortSignal,
		) {
			const currentAttempt = ++attempt;
			signal.throwIfAborted();
			const before =
				snapshot?.chat === chat && text.startsWith(snapshot.text)
					? snapshot
					: undefined;
			let id = before?.id ?? crypto.randomUUID();
			let reset = !before;
			let response = await send(
				before
					? {
							streamId: id,
							baseRevision: before.revision,
							append: text.slice(before.text.length),
							streaming,
							chat,
						}
					: { streamId: id, text, streaming, chat },
				signal,
			);
			signal.throwIfAborted();
			if (response.status === 409) {
				// Eviction, server restart, or a cancelled request whose native work
				// finished: reconstruct once using a fresh identity.
				id = crypto.randomUUID();
				reset = true;
				response = await send({ streamId: id, text, streaming, chat }, signal);
				signal.throwIfAborted();
			}
			if (!response.ok) {
				const failure = await response.json().catch(() => null);
				throw new Error(
					failure?.error ?? `Markdown request failed (${response.status})`,
				);
			}
			const patch: MarkdownPatch = await response.json();
			signal.throwIfAborted();
			const expectedRevision = reset ? 1 : before!.revision + 1;
			if (
				patch.version !== 1 ||
				!Array.isArray(patch.blocks) ||
				patch.reset !== reset ||
				patch.revision !== expectedRevision ||
				!Number.isSafeInteger(patch.start) ||
				patch.start < 0 ||
				!Number.isSafeInteger(patch.deleteCount) ||
				patch.deleteCount < 0 ||
				(reset
					? patch.start !== 0
					: patch.start + patch.deleteCount !== before!.blocks.length)
			) {
				throw new Error("Unsupported Markdown stream response");
			}
			const blocks = reset
				? patch.blocks
				: [...before!.blocks.slice(0, patch.start), ...patch.blocks];
			if (attempt === currentAttempt)
				snapshot = { id, text, chat, revision: patch.revision, blocks };
			return { version: 1 as const, blocks };
		},
	};
}
