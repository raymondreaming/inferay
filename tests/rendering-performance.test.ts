import { describe, expect, test } from "bun:test";
import { ByteCache } from "../src/shared/lib/byte-cache.ts";

describe("bounded rendering models", () => {
	test("byte cache evicts least recently used entries and rejects oversized values", () => {
		const cache = new ByteCache<string>(10, 3);
		cache.set("a", "a", 4);
		cache.set("b", "b", 4);
		cache.get("a");
		cache.set("c", "c", 4);
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("a")).toBe("a");
		cache.set("large", "large", 11);
		expect(cache.size).toBe(2);
		expect(cache.retainedBytes).toBe(8);
		cache.delete("a");
		expect(cache.retainedBytes).toBe(4);
	});
});
