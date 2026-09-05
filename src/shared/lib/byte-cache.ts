/** Access-ordered cache with both entry and retained-byte limits. */
export class ByteCache<T> {
	private entries = new Map<string, { value: T; bytes: number }>();
	private bytes = 0;
	constructor(
		private maxBytes: number,
		private maxEntries: number,
	) {}
	get(key: string): T | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}
	set(key: string, value: T, bytes: number) {
		this.delete(key);
		if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes) return;
		this.entries.set(key, { value, bytes });
		this.bytes += bytes;
		while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
			const first = this.entries.keys().next().value;
			if (first === undefined) break;
			this.delete(first);
		}
	}
	delete(key: string) {
		const entry = this.entries.get(key);
		if (!entry) return;
		this.bytes -= entry.bytes;
		this.entries.delete(key);
	}
	keys() {
		return this.entries.keys();
	}
	get size() {
		return this.entries.size;
	}
	get retainedBytes() {
		return this.bytes;
	}
}
