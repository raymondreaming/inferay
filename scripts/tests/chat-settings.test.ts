import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as signals from "@solidjs/signals";

test("workspace replacement retains resolved provider settings and real changes still save", async () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/conversation/hooks/useAgentChatMenus.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const start = source.indexOf("export function useAgentChatSettings(");
	const end = source.indexOf("\nexport ", start + 1);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source.slice(start, end).replace("export ", ""),
	);
	const requests: Record<string, string>[] = [];
	const dependencies = {
		...signals,
		getAgentDefinition: (kind: string) => ({ label: kind }),
		postJson: async (_url: string, body: Record<string, string>) => {
			requests.push(body);
			return { model: body.model ?? "default", reasoningLevel: "low" };
		},
	};
	const hook = new Function(
		...Object.keys(dependencies),
		`${code}; return useAgentChatSettings;`,
	)(...Object.values(dependencies));
	let dispose = () => {};
	let update!: (value: typeof workspace) => void;
	let settings: ReturnType<typeof hook>;
	let workspace = { paneId: "pane", kind: "codex", selected: "one" };
	signals.createRoot((cleanup) => {
		dispose = cleanup;
		const [state, setState] = signals.createSignal(workspace);
		update = setState;
		settings = hook(
			() => state().paneId,
			() => state().kind,
		);
	});
	const settle = async () => {
		for (let i = 0; i < 8; i++) {
			signals.flush();
			await Promise.resolve();
		}
	};
	try {
		await settle();
		expect(requests).toHaveLength(1);
		expect(settings.effectiveSelectedModel).toBe("default");
		for (const selected of ["two", "one", "one"]) {
			workspace = { ...workspace, selected };
			update(workspace);
			await settle();
		}
		expect(requests).toHaveLength(1);
		settings.handleModelChange("chosen");
		await settle();
		expect(requests[1]).toEqual({
			paneId: "pane",
			agentKind: "codex",
			model: "chosen",
		});
		expect(settings.effectiveSelectedModel).toBe("chosen");
		update({ ...workspace, kind: "claude" });
		await settle();
		expect(requests[2]).toEqual({ paneId: "pane", agentKind: "claude" });
		expect(requests).toHaveLength(3);
	} finally {
		dispose();
		signals.flush();
	}
});
