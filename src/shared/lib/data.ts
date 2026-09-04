export function isString(value: unknown): value is string {
	return typeof value === "string";
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

export function contentOf<T extends { content: string }>(item: T): string {
	return item.content;
}

export function hasId(id: unknown, item: { id: string }): boolean {
	return item.id === id;
}

export function lacksId(id: unknown, item: { id: string }): boolean {
	return item.id !== id;
}

export function lacksObjectId(id: unknown, item: { _id: string }): boolean {
	return item._id !== id;
}

export function hasPath(path: unknown, item: { path: string }): boolean {
	return item.path === path;
}

export function lacksValue<T>(value: T, item: T): boolean {
	return item !== value;
}

export function hasRole(role: unknown, item: { role: string }): boolean {
	return item.role === role;
}
