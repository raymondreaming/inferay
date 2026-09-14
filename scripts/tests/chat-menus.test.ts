import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { project } from "@shared/lib/native.tsx";
import * as signals from "@solidjs/signals";

test("completion menus hide while disabled and retain their selection when enabled again", () => {
	const source = readFileSync(
		new URL(
			"../../src/modules/conversation/hooks/useAgentChatMenus.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
		[
			source.slice(
				source.indexOf("export function useAgentChatMenus"),
				source.indexOf("export function useAgentChatSettings"),
			),
			source.slice(source.indexOf("export function hideMenuState")),
		]
			.join("\n")
			.replaceAll("export ", ""),
	);
	const commands = [{ name: "review", description: "Review changes" }];
	const queries: Array<() => { enabled: boolean }> = [];
	const dependencies = {
		...signals,
		rustProject: project,
		getAgentDefinition: () => ({ commands }),
		useQueryResource: (
			_request: unknown,
			fallback: () => unknown,
			options: () => { enabled: boolean },
		) => {
			queries.push(options);
			return {
				get data() {
					return fallback();
				},
			};
		},
	};
	const hook = new Function(
		...Object.keys(dependencies),
		`${code}; return useAgentChatMenus;`,
	)(...Object.values(dependencies));
	signals.createRoot((dispose) => {
		try {
			const [enabled, setEnabled] = signals.createSignal<boolean | undefined>(
				undefined,
			);
			const menus = hook(() => ({
				agentKind: "codex",
				enabled: enabled(),
				input: "",
				setInput: () => {},
				textareaRef: { current: null },
			}));
			menus.handleInputForSlashMenu("/re", 3);
			menus.handleInputForFileMenu("@src", 4);
			signals.flush();
			expect(menus.filteredCommands).toEqual(commands);
			expect(menus.showCommands).toBe(true);
			expect(menus.fileMenu).toMatchObject({ show: true, query: "src" });
			expect(queries.map((options) => options().enabled)).toEqual([true, true]);
			setEnabled(false);
			signals.flush();
			menus.handleInputForSlashMenu("/different", 10);
			menus.handleInputForFileMenu("@different", 10);
			expect(menus.fileMenu.show).toBe(false);
			expect(menus.slashMenu.show).toBe(false);
			expect(menus.showCommands).toBe(false);
			expect(queries.map((options) => options().enabled)).toEqual([
				false,
				false,
			]);
			setEnabled(true);
			signals.flush();
			expect(menus.fileMenu).toMatchObject({ show: true, query: "src" });
			expect(menus.slashMenu).toMatchObject({ show: true, query: "re" });
			menus.handleInputForSlashMenu("plain", 5);
			signals.flush();
			expect(menus.showCommands).toBe(false);
		} finally {
			dispose();
		}
	});
});
