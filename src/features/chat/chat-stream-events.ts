export function stringifyToolInput(input: unknown): string {
	if (input === undefined || input === null) return "";
	return typeof input === "string" ? input : JSON.stringify(input, null, 2);
}

export function getToolBlockInitialContent(block: unknown): string {
	if (!block || typeof block !== "object") return "";
	const input = (block as { input?: unknown }).input;
	return stringifyToolInput(input);
}
