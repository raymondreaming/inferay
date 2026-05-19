export function isString(value: unknown): value is string {
	return typeof value === "string";
}

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export function isPresent<T>(value: T | null | undefined): value is T {
	return value != null;
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

export function runAsync(task: () => Promise<unknown>): void {
	void task();
}

export function runIfMounted(
	mountedRef: { current: boolean },
	action: () => Promise<unknown> | void
): void {
	if (mountedRef.current) void action();
}

export function withRecordEntry<T>(
	key: string,
	value: T
): (current: Record<string, T>) => Record<string, T> {
	return (current) => ({ ...current, [key]: value });
}

export function isFirstPath<T extends { path: string }>(
	seen: Set<string>,
	item: T
): boolean {
	if (seen.has(item.path)) return false;
	seen.add(item.path);
	return true;
}

export function setRecordEntry<T>(
	setRecord: (
		updater: (current: Record<string, T>) => Record<string, T>
	) => void,
	key: string,
	value: T
): void {
	setRecord(withRecordEntry(key, value));
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

export function lacksPath(path: unknown, item: { path: string }): boolean {
	return item.path !== path;
}

export function hasCwd(cwd: unknown, item: { cwd: string }): boolean {
	return item.cwd === cwd;
}

export function hasCommand(
	command: unknown,
	item: { command: string }
): boolean {
	return item.command === command;
}

export function hasPid(pid: unknown, item: { pid: number }): boolean {
	return item.pid === pid;
}

export function hasPpid(ppid: unknown, item: { ppid: number }): boolean {
	return item.ppid === ppid;
}

export function lacksValue<T>(value: T, item: T): boolean {
	return item !== value;
}

export function ppidNotIn(seen: Set<number>, item: { ppid: number }): boolean {
	return !seen.has(item.ppid);
}

export function hasRole(role: unknown, item: { role: string }): boolean {
	return item.role === role;
}

export function hasPaneId(paneId: unknown, item: { paneId: string }): boolean {
	return item.paneId === paneId;
}

export function removePidFromList<T extends { pid: number }>(
	pid: number
): (items: T[]) => T[] {
	return (items) => items.filter((item) => item.pid !== pid);
}

export function rangeContainsLine(
	ranges: readonly { start: number; end: number }[],
	line: number
): boolean {
	for (const range of ranges) {
		if (line >= range.start && line <= range.end) return true;
	}
	return false;
}

export function uniqueTrimmedStrings(values: Iterable<string>): string[] {
	return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}
