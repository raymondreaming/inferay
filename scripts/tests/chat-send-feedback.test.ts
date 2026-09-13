import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { project } from "../../src/shared/lib/native.tsx";

function setup(fail = false) {
	const source = readFileSync(
		new URL(
			"../../src/modules/conversation/hooks/useChatInputActions.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source
			.slice(source.indexOf("export function useChatInputActions"))
			.replace("export ", ""),
	);
	let status = {
		isLoading: false,
		status: "idle",
		startTime: null as number | null,
	};
	const events: string[] = [];
	let sequence = 0;
	const actions = new Function(
		"rustProject",
		"wsClient",
		"nextId",
		"options",
		`${code}; return useChatInputActions(() => options);`,
	)(
		project,
		{
			send() {
				events.push("transport");
				if (fail) throw new Error("Socket failed");
			},
		},
		() => String(++sequence),
		{
			agentKind: "claude",
			paneId: "p",
			get isLoading() {
				return status.isLoading;
			},
			setMessages() {
				events.push("message");
			},
			onRunStart() {
				status = project("chatRunStatus", {
					current: status,
					begin: true,
					now: 1234,
				});
				events.push("activity");
			},
			onSendStart() {
				events.push("scroll");
			},
			onSendError() {
				status = { isLoading: false, status: "error", startTime: null };
				events.push("error");
			},
		},
	);
	return { actions, events, status: () => status };
}
test("accepted send starts activity and the timer before transport, without waiting for any reply", () => {
	const { actions, events, status } = setup();
	expect(actions.sendUserMessage({ text: "hello" })).toBe(true);
	expect(events).toEqual(["activity", "message", "scroll", "transport"]);
	expect(status()).toEqual({
		isLoading: true,
		status: "sending",
		startTime: 1234,
	});
	events.length = 0;
	actions.sendUserMessage({ text: "follow up" });
	expect(events).toEqual(["scroll", "transport"]);
	expect(status().startTime).toBe(1234);
});
test("empty submissions do nothing and a failed transport clears pending activity", () => {
	const { actions, events, status } = setup(true);
	expect(actions.sendUserMessage({ text: "   " })).toBe(false);
	expect(events).toEqual([]);
	expect(actions.sendUserMessage({ text: "hello" })).toBe(false);
	expect(events.at(-1)).toBe("error");
	expect(status().isLoading).toBe(false);
});
