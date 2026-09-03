export function isString(value: unknown): value is string {
	return typeof value === "string";
}

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export function isActive(value: { active: boolean }): boolean {
	return value.active;
}

export function isBuiltIn(value: { isBuiltIn: boolean }): boolean {
	return value.isBuiltIn;
}

export function incrementNumber(value: number): number {
	return value + 1;
}

export function toggleBoolean(value: boolean): boolean {
	return !value;
}

export function noop(): void {}

export function isFirstPath<T extends { path: string }>(
	seen: Set<string>,
	item: T,
): boolean {
	if (seen.has(item.path)) return false;
	seen.add(item.path);
	return true;
}

export function comparePort(a: { port: number }, b: { port: number }): number {
	return a.port - b.port;
}

export function compareName(a: { name: string }, b: { name: string }): number {
	return a.name.localeCompare(b.name);
}

export function contentOf<T extends { content: string }>(item: T): string {
	return item.content;
}

export function hasId(id: unknown, item: { id: string }): boolean {
	return item.id === id;
}

export function lacksId(id: unknown, item: { id: string }): boolean {
	return item.id !== id;
}

export function hasObjectId(id: unknown, item: { _id: string }): boolean {
	return item._id === id;
}

export function lacksObjectId(id: unknown, item: { _id: string }): boolean {
	return item._id !== id;
}

export function hasUdid(udid: unknown, item: { udid: string }): boolean {
	return item.udid === udid;
}

export function hasPath(path: unknown, item: { path: string }): boolean {
	return item.path === path;
}

export function hasCommand(
	command: unknown,
	item: { command: string },
): boolean {
	return item.command === command;
}

export function hasPid(pid: unknown, item: { pid: number }): boolean {
	return item.pid === pid;
}

export function lacksValue<T>(value: T, item: T): boolean {
	return item !== value;
}

export function hasRole(role: unknown, item: { role: string }): boolean {
	return item.role === role;
}

export function rangeContainsLine(
	ranges: readonly { start: number; end: number }[],
	line: number,
): boolean {
	for (const range of ranges) {
		if (line >= range.start && line <= range.end) return true;
	}
	return false;
}

export function uniqueTrimmedStrings(values: Iterable<string>): string[] {
	return [
		...new Set(
			[...values].flatMap((value) => {
				const trimmed = value.trim();
				return trimmed ? [trimmed] : [];
			}),
		),
	];
}
