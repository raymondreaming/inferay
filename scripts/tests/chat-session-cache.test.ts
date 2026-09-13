import { expect, test } from "bun:test";
import {
	createChatSessionCache,
	type RetainedChatSession,
} from "../../src/modules/conversation/components/AgentChatView/chatSessionCache.ts";

function session(content = "retained") {
	let frees = 0;
	const value = {
		paneId: "pane",
		replica: {
			free() {
				frees++;
			},
		},
		messages: [{ id: "m", role: "assistant", content }],
		checkpoints: [],
		nativeTranscript: null,
		expandedTools: new Set(),
		runStatus: { isLoading: false, status: "idle", startTime: null },
	} as unknown as RetainedChatSession;
	return { value, frees: () => frees };
}

test("taking a cached session transfers the same messages and replica without freeing them", () => {
	const cache = createChatSessionCache(2);
	const retained = session();
	cache.retain("pane", retained.value);
	expect(cache.take("pane")).toBe(retained.value);
	expect(cache.take("pane")).toBeUndefined();
	expect(retained.frees()).toBe(0);
	cache.retain("pane", retained.value);
	expect(cache.take("pane")!.messages).toBe(retained.value.messages);
});

test("inactive entry and weight budgets dispose only evicted replicas", () => {
	const cache = createChatSessionCache(1, 1600);
	const first = session();
	const second = session();
	cache.retain("first", first.value);
	cache.retain("second", second.value);
	expect(first.frees()).toBe(1);
	expect(cache.take("first")).toBeUndefined();
	expect(cache.take("second")).toBe(second.value);
	expect(second.frees()).toBe(0);
	const oversized = session("a".repeat(1000));
	cache.retain("large", oversized.value);
	expect(oversized.frees()).toBe(1);
	expect(cache.take("large")).toBeUndefined();
});

test("replacing the same identity frees its former replica exactly once", () => {
	const cache = createChatSessionCache();
	const old = session();
	const replacement = session();
	cache.retain("pane", old.value);
	cache.retain("pane", old.value);
	expect(old.frees()).toBe(0);
	cache.retain("pane", replacement.value);
	expect(old.frees()).toBe(1);
	expect(replacement.frees()).toBe(0);
});

test("removed panes release cached replicas and cannot be recached by later component cleanup", () => {
	const cache = createChatSessionCache();
	const cached = session();
	const active = session();
	cache.setPaneIds(["pane"]);
	cache.retain("cached", cached.value);
	cache.setPaneIds([]);
	expect(cached.frees()).toBe(1);
	expect(cache.take("cached")).toBeUndefined();
	cache.retain("active", active.value);
	expect(active.frees()).toBe(1);
	expect(cache.take("active")).toBeUndefined();
});
