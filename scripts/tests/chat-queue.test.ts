import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { project } from "@shared/lib/native.tsx";
import * as signals from "@solidjs/signals";

test("queue mutations retain newer stream updates and stop after disposal", async () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/conversation/hooks/useAgentChatComposerState.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source
			.slice(
				source.indexOf("export function useAgentChatComposerState"),
				source.indexOf("export function usePendingChatWorkspace"),
			)
			.replace("export ", ""),
	);
	let dispose = () => {};
	let resolve = (_queue: unknown[]) => {};
	let requests = 0;
	const dependencies = {
		...signals,
		onCleanup: (cleanup: () => void) => {
			dispose = cleanup;
		},
		useQueryResource: () => ({}),
		rustProject: project,
		updateChatQueue: () => {
			requests++;
			return new Promise((accept) => {
				resolve = accept;
			});
		},
	};
	const hook = new Function(
		...Object.keys(dependencies),
		`${code}; return useAgentChatComposerState;`,
	)(...Object.values(dependencies));
	await signals.createRoot(async (rootDispose) => {
		try {
			const state = hook(() => "pane");
			state.replaceQueuedMessages([{ id: "saved", text: "original" }]);
			state.stageSteeringMessage({ id: "pending", text: "steer" });
			state.updateQueuedMessage("saved", "edit");
			await Promise.resolve();
			await Promise.resolve();
			expect(requests).toBe(1);
			state.replaceQueuedMessages([{ id: "newer", text: "stream update" }]);
			resolve([{ id: "saved", text: "edit" }]);
			await new Promise((accept) => setTimeout(accept, 0));
			expect(
				state.queuedMessages.map((item: { id: string }) => item.id),
			).toEqual(["newer", "pending"]);
			state.resolveSteeringMessage("pending");
			signals.flush();
			expect(state.queuedMessages).toEqual([
				{ id: "newer", text: "stream update" },
			]);
			dispose();
			state.removeQueuedMessage("newer");
			await Promise.resolve();
			await Promise.resolve();
			expect(requests).toBe(1);
		} finally {
			rootDispose();
		}
	});
});
