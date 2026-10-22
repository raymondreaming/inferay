import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as signals from "@solidjs/signals";
import type { useAgentChatSettings } from "../../src/modules/conversation/hooks/useAgentChatMenus.tsx";
import type { resolveProviderConfig } from "../../src/modules/conversation/services/conversationApi.ts";

function setup(resolve: typeof resolveProviderConfig) {
	const source = readFileSync(
		new URL(
			"../../src/modules/conversation/hooks/useAgentChatMenus.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		source
			.slice(
				source.indexOf("export function useAgentChatSettings"),
				source.indexOf("export function hideMenuState"),
			)
			.replace("export ", ""),
	);
	const dependencies = {
		...signals,
		resolveProviderConfig: resolve,
		getAgentDefinition: (id: string) => ({ label: id }),
		changePaneAgentKind() {},
	};
	const useSettings = new Function(
		...Object.keys(dependencies),
		`${code}; return useAgentChatSettings;`,
	)(...Object.values(dependencies)) as typeof useAgentChatSettings;
	return signals.createRoot((dispose) => {
		const [pane, setPane] = signals.createSignal("one");
		const settings = useSettings(pane, () => "codex");
		return { settings, setPane, dispose };
	});
}

test("chat settings recover from failed loading and retry the actual failed model choice", async () => {
	let failing = true;
	const requests: Parameters<typeof resolveProviderConfig>[0][] = [];
	const fixture = setup(async (input) => {
		requests.push(input);
		if (failing) throw new Error("offline");
		return { model: input.model ?? "default", reasoningLevel: "low" };
	});
	try {
		signals.flush();
		await Bun.sleep(0);
		expect(fixture.settings.configurationError).toBe(
			"Chat settings could not be loaded.",
		);
		failing = false;
		await fixture.settings.retryConfiguration();
		expect(fixture.settings.configurationError).toBeNull();
		expect(fixture.settings.effectiveSelectedModel).toBe("default");
		failing = true;
		await fixture.settings.handleModelChange("chosen");
		expect(fixture.settings.configurationError).toBe(
			"Chat settings could not be saved.",
		);
		expect(fixture.settings.effectiveSelectedModel).toBe("default");
		failing = false;
		await fixture.settings.retryConfiguration();
		expect(requests.at(-1)).toEqual({
			paneId: "one",
			agentKind: "codex",
			model: "chosen",
		});
		expect(fixture.settings.effectiveSelectedModel).toBe("chosen");
		expect(fixture.settings.configurationError).toBeNull();
	} finally {
		fixture.dispose();
	}
});

test("a late settings failure cannot leak a previous pane's choice into the next pane", async () => {
	const pending = Promise.withResolvers<{
		model: string;
		reasoningLevel: string;
	}>();
	const requests: Parameters<typeof resolveProviderConfig>[0][] = [];
	const fixture = setup((input) => {
		requests.push(input);
		return input.paneId === "one"
			? pending.promise
			: Promise.resolve({ model: "second", reasoningLevel: "high" });
	});
	try {
		signals.flush();
		await Bun.sleep(0);
		fixture.setPane("two");
		signals.flush();
		pending.reject(new Error("late failure"));
		await Bun.sleep(0);
		expect(fixture.settings.configurationError).toBeNull();
		expect(fixture.settings.effectiveSelectedModel).toBe("second");
		await fixture.settings.retryConfiguration();
		expect(requests.at(-1)).toEqual({ paneId: "two", agentKind: "codex" });
	} finally {
		fixture.dispose();
	}
});
