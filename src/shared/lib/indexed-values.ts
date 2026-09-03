export interface IndexedValue<T> {
	index: number;
	value: T;
}

/**
 * Keeps a render-list index on the item object. This avoids compiler-generated
 * JSX key functions closing over a map callback's second parameter.
 */
export function indexedValues<T>(values: readonly T[]): IndexedValue<T>[] {
	return values.map((value, index) => ({ index, value }));
}
