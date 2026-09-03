export type CommandSystemMessage = {
	type: "inferay.command";
	name: string;
	description?: string;
	args?: string;
};

export function serializeCommandSystemMessage(
	message: CommandSystemMessage,
): string {
	return JSON.stringify(message);
}

export function parseCommandSystemMessage(
	content: string,
): CommandSystemMessage | null {
	if (!content.trim().startsWith("{")) return null;
	try {
		const parsed = JSON.parse(content) as Partial<CommandSystemMessage>;
		if (
			parsed?.type !== "inferay.command" ||
			typeof parsed.name !== "string" ||
			!parsed.name.trim()
		) {
			return null;
		}
		return {
			type: "inferay.command",
			name: parsed.name,
			description:
				typeof parsed.description === "string" ? parsed.description : undefined,
			args: typeof parsed.args === "string" ? parsed.args : undefined,
		};
	} catch {
		return null;
	}
}
