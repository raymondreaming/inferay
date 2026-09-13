import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as signals from "@solidjs/signals";

test("workspace replacement and visibility changes retain chat subscriptions; identity changes reconnect", () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/conversation/components/AgentChatView/useChatConnection.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const start = source.indexOf("export function useChatConnection(");
	const end = source.indexOf("\nexport ", start + 1);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source.slice(start, end < 0 ? undefined : end).replace("export ", ""),
	);
	const sent: { type: string; cwd?: string }[] = [];
	let subscriptions = 0;
	let cleared = 0;
	const dependencies = {
		...signals,
		DEFAULT_CHAT_RUN_STATUS: {
			isLoading: false,
			status: "idle",
			startTime: null,
		},
		chatSessionCache: { take: () => undefined, retain: () => {} },
		ChatReplica: class {
			reconnect() {}
			cursor() {
				return "{}";
			}
			clear() {
				cleared++;
			}
		},
		wsClient: {
			subscribe: () => {
				subscriptions++;
				return () => {
					subscriptions--;
				};
			},
			send: (message: { type: string; cwd?: string }) => sent.push(message),
			onReconnect: () => () => {},
		},
	};
	const hook = new Function(
		...Object.keys(dependencies),
		`${code}; return useChatConnection;`,
	)(...Object.values(dependencies));
	let dispose = () => {};
	let update!: (value: {
		cwd: string;
		selected: string;
		visible: boolean;
		enabled: boolean;
	}) => void;
	let value = {
		cwd: "/real/repository",
		selected: "one",
		visible: true,
		enabled: true,
	};
	signals.createRoot((cleanup) => {
		dispose = cleanup;
		const [workspace, setWorkspace] = signals.createSignal(value);
		update = setWorkspace;
		const options = {
			get cwd() {
				return workspace().cwd;
			},
			get enabled() {
				return workspace().enabled;
			},
			get visible() {
				return workspace().visible;
			},
			get paneId() {
				workspace();
				return "pane";
			},
			agentKind: "claude",
			replaceQueuedMessages: () => {},
		};
		hook(() => options);
	});
	const change = (patch: Partial<typeof value>) => {
		value = { ...value, ...patch };
		update(value);
		signals.flush();
	};
	try {
		signals.flush();
		expect(sent.map((message) => message.type)).toEqual(["chat:reconnect"]);
		change({ selected: "two", visible: false });
		change({ selected: "one", visible: true });
		change({});
		expect(subscriptions).toBe(1);
		expect(sent.map((message) => message.type)).toEqual(["chat:reconnect"]);
		change({ cwd: "/another/repository" });
		expect(cleared).toBe(1);
		expect(sent.slice(-2).map((message) => message.type)).toEqual([
			"chat:unsubscribe",
			"chat:reconnect",
		]);
		expect(sent.at(-1)?.cwd).toBe("/another/repository");
		change({ enabled: false });
		expect(subscriptions).toBe(0);
		change({ enabled: true });
		expect(subscriptions).toBe(1);
	} finally {
		dispose();
	}
	expect(subscriptions).toBe(0);
});
