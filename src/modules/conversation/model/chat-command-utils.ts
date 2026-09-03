type ChatCommandShape = {
	id?: string;
	name: string;
	promptTemplate?: string;
};

export function getCommandDisplayText(
	command: Pick<ChatCommandShape, "name">,
	args?: string,
): string {
	return `/${command.name}${args ? ` ${args}` : ""}`;
}

export function getCommandPrompt(
	command: Pick<ChatCommandShape, "name" | "promptTemplate">,
	args?: string,
): string {
	if (command.promptTemplate) {
		return command.promptTemplate.replace("{args}", args || "").trim();
	}
	return getCommandDisplayText(command, args).trim();
}

export function expandInlineCommandPrompts(
	text: string,
	commands: ChatCommandShape[],
): { expandedText: string; usedCommandIds: string[] } {
	let expandedText = text;
	const usedCommandIds: string[] = [];
	const commandsByName = new Map(
		commands.map((command) => [command.name.toLowerCase(), command]),
	);
	const commandRegex = /(^|\s)(\/[a-zA-Z][\w-]*)(?=\s|$)/g;
	let match: RegExpExecArray | null;

	match = commandRegex.exec(text);
	while (match !== null) {
		const commandToken = match[2]!;
		const commandName = commandToken.slice(1).toLowerCase();
		const command = commandsByName.get(commandName);
		if (command) {
			const expanded = command.promptTemplate
				? command.promptTemplate.replace("{args}", "").trim()
				: commandToken;
			expandedText = expandedText.replace(commandToken, expanded);
			if (command.id) usedCommandIds.push(command.id);
		}
		match = commandRegex.exec(text);
	}

	return { expandedText, usedCommandIds };
}

export function applyInlineCompletion(
	input: string,
	cursorPos: number,
	triggerIndex: number,
	replacement: string,
): { nextValue: string; nextCursor: number } {
	const before = input.slice(0, triggerIndex);
	const after = input.slice(cursorPos);
	const nextValue = `${before}${replacement}${after ? after : " "}`;
	return {
		nextValue,
		nextCursor: before.length + replacement.length + (after ? 0 : 1),
	};
}
