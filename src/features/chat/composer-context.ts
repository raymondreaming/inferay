import type { ComposerContextBlock } from "./agent-chat-shared.ts";

const ACTIVE_COMPOSER_KEY = "inferay-active-composer-pane";

function compact(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function blockRange(block: ComposerContextBlock): string | null {
	if (!block.path) return null;
	if (typeof block.lineStart !== "number") return block.path;
	const end =
		typeof block.lineEnd === "number" && block.lineEnd !== block.lineStart
			? `-${block.lineEnd}`
			: "";
	return `${block.path}:${block.lineStart}${end}`;
}

export function describeComposerContextBlock(
	block: ComposerContextBlock
): string {
	return compact(
		[block.title, blockRange(block), block.subtitle].filter(Boolean).join(" · ")
	);
}

export function formatComposerContextBlock(
	block: ComposerContextBlock
): string {
	const range = blockRange(block);
	const heading = [
		`source=${block.source}`,
		range ? `range=${range}` : null,
		block.subtitle ? `note=${block.subtitle}` : null,
	]
		.filter(Boolean)
		.join(" ");
	return [
		`### ${block.title}`,
		heading ? `<!-- ${heading} -->` : null,
		"```",
		block.content.trim(),
		"```",
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}

export function buildComposerPrompt(
	text: string,
	contextBlocks: ComposerContextBlock[] = []
): string {
	const sections: string[] = [];
	if (contextBlocks.length > 0) {
		sections.push(
			[
				"Targeted context for this next message:",
				...contextBlocks.map(formatComposerContextBlock),
			].join("\n\n")
		);
	}
	if (text.trim()) sections.push(text.trim());
	return sections.join("\n\n");
}

export function makeComposerContextBlock(
	block: Omit<ComposerContextBlock, "id" | "createdAt"> &
		Partial<Pick<ComposerContextBlock, "id" | "createdAt">>
): ComposerContextBlock {
	const createdAt = block.createdAt ?? Date.now();
	const seed = [
		block.source,
		block.title,
		block.path,
		block.lineStart,
		block.lineEnd,
		block.content,
		createdAt,
	].join("|");
	let hash = 0;
	for (let index = 0; index < seed.length; index++) {
		hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
	}
	return {
		...block,
		id: block.id ?? `ctx-${hash.toString(36)}`,
		createdAt,
	};
}

export function markActiveComposerPane(paneId: string) {
	try {
		localStorage.setItem(ACTIVE_COMPOSER_KEY, paneId);
	} catch {
		// Local storage can be unavailable in tests or restricted contexts.
	}
}

export function loadActiveComposerPane(): string | null {
	try {
		return localStorage.getItem(ACTIVE_COMPOSER_KEY);
	} catch {
		return null;
	}
}

export function dispatchComposerContextBlock(
	block: Omit<ComposerContextBlock, "id" | "createdAt"> &
		Partial<Pick<ComposerContextBlock, "id" | "createdAt">>,
	paneId?: string | null
) {
	const detail = makeComposerContextBlock(block);
	const targetPaneId = paneId ?? loadActiveComposerPane() ?? null;
	window.dispatchEvent(
		new CustomEvent("inferay:add-composer-context", {
			detail: {
				...detail,
				paneId: targetPaneId ?? undefined,
			},
		})
	);
}
