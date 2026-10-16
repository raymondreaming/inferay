import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { GitActionResponse, GitGraphActionRequest } from "@contracts";
import * as signals from "@solidjs/signals";
import { project } from "../../src/shared/lib/native.tsx";

test("one click executes the requested action before reactive state flushes", async () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/repository/components/operations/ChatDiffPanel/useChatDiffPanelState.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(
		source
			.slice(source.indexOf("export function useChatDiffPanelState"))
			.replace("export ", ""),
	);
	const sent: GitGraphActionRequest[] = [];
	const response = Promise.withResolvers<GitActionResponse>();
	const dependencies = {
		...signals,
		project,
		queryClient: {},
		useQuery: () => ({}),
		merge: (...sources: object[]) =>
			Object.assign(
				{},
				...sources.map((s) => (typeof s === "function" ? s() : s)),
			),
	};
	// Use client signals: server signals commit immediately and miss the stale-read bug.
	const create = new Function(
		...Object.keys(dependencies),
		`${code}; return useChatDiffPanelState;`,
	)(...Object.values(dependencies));
	let dispose = () => {};
	signals.createRoot((cleanup) => {
		dispose = cleanup;
		const actions = create(() => ({
			graph: {
				actions: {
					fetch: { needsConfirm: false },
					push: { needsConfirm: false },
				},
			},
			onRunGraphAction: (request: GitGraphActionRequest) => {
				sent.push(request);
				return response.promise;
			},
		}));
		actions.requestGraphAction({ action: "fetch", itemId: "repository" });
		actions.requestGraphAction({ action: "push", itemId: "repository" });
	});
	expect(sent.map((r) => r.action)).toEqual(["fetch"]);
	response.resolve({
		ok: true,
		operation: "fetch",
		outcome: "completed",
		conflicts: [],
		errorLabel: "",
	});
	await response.promise;
	signals.flush();
	dispose();
});
