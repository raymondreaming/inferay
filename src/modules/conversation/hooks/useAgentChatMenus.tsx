import type { CompletionMenuState, WorkspaceAgentKind } from "@contracts";
import {
	type ChatFileSearchResult,
	loadAgentCommands,
	type ProviderConfigSelection,
	resolveProviderConfig,
	searchChatFiles,
} from "@conversation/services/conversationApi.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import type { Dispatch, RefCell, StateUpdate } from "@shared/lib/dom.tsx";
import {
	getAgentDefinition,
	project as rustProject,
} from "@shared/lib/native.tsx";
import { changePaneAgentKind } from "@workspace/hooks/useWorkspaceState.tsx";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
} from "solid-js";
export type FileSearchResult = ChatFileSearchResult;
interface UseAgentChatMenusOptions {
	agentKind: WorkspaceAgentKind;
	cwd?: string;
	enabled?: boolean;
	input: string;
	setInput: (value: string) => void;
	textareaRef: RefCell<HTMLTextAreaElement | null>;
}
export function useAgentChatMenus(
	_options: Accessor<UseAgentChatMenusOptions>,
) {
	const enabled = createMemo(() => _options().enabled !== false);
	const [fileMenu, setFileMenu] = createSignal<CompletionMenuState>({
		show: false,
		selectedIdx: 0,
		query: "",
		index: -1,
	});
	const [slashMenu, setSlashMenu] = createSignal<CompletionMenuState>({
		show: false,
		selectedIdx: 0,
		query: "",
		index: -1,
	});
	const _source = useQueryResource(
		() => {
			const kind = _options().agentKind;
			return (signal) => loadAgentCommands(kind, signal);
		},
		() => getAgentDefinition(_options().agentKind).commands,
		() => {
			const _optionsValue = _options();
			return {
				queryKey: ["skills", "commands", _optionsValue.agentKind],
				enabled: enabled(),
			};
		},
	);
	const _source2 = useQueryResource(
		() => {
			const cwd = _options().cwd;
			const query = fileMenu().query;
			return async (signal) => {
				await new Promise((resolve) => setTimeout(resolve, 150));
				signal?.throwIfAborted();
				return searchChatFiles(query, cwd, signal);
			};
		},
		() => [] as FileSearchResult[],
		() => {
			const _optionsValue3 = _options(),
				_fileMenuValue = fileMenu();
			return {
				queryKey: [
					"file-completion",
					_optionsValue3.cwd ?? "",
					_fileMenuValue.query,
				],
				enabled: enabled() && _fileMenuValue.show,
				gcTime: 0,
			};
		},
	);
	const slashCommandNames = createMemo(() =>
		_source.data.map((command) => command.name),
	);
	const filteredCommands = createMemo(() =>
		rustProject<number[]>("completionMenuCommands", {
			state: slashMenu(),
			commands: _source.data,
		}).map((index) => _source.data[index]!),
	);
	const visibleFileMenu = createMemo(() =>
		enabled() ? fileMenu() : hideMenuState(fileMenu()),
	);
	const visibleSlashMenu = createMemo(() =>
		enabled() ? slashMenu() : hideMenuState(slashMenu()),
	);
	const handleInput = (
		value: string,
		cursorPos: number,
		trigger: "/" | "@",
		setMenu: Dispatch<StateUpdate<CompletionMenuState>>,
	) => {
		if (!enabled()) return;
		setMenu(
			(state) =>
				rustProject<CompletionMenuState | null>("completionMenuInput", {
					state,
					value,
					cursorPos,
					trigger,
				}) ?? state,
		);
	};
	const select = (kind: "command" | "file", index: number) => {
		const options = _options();
		const result = rustProject<{
			nextValue: string;
			nextCursor: number;
		} | null>("selectCompletion", {
			kind,
			index,
			items: kind === "command" ? filteredCommands() : _source2.data,
			menu: kind === "command" ? slashMenu() : fileMenu(),
			input: options.input,
			cursorPos:
				options.textareaRef.current?.selectionStart ?? options.input.length,
		});
		if (!result) return;
		options.setInput(result.nextValue);
		(kind === "command" ? setSlashMenu : setFileMenu)(hideMenuState);
		requestAnimationFrame(() => {
			const textarea = _options().textareaRef.current;
			textarea?.focus();
			textarea?.setSelectionRange(result.nextCursor, result.nextCursor);
		});
	};
	return {
		get allCommands() {
			return _source.data;
		},
		get fileMenu() {
			return visibleFileMenu();
		},
		setFileMenu,
		get fileResults() {
			return _source2.data;
		},
		get slashMenu() {
			return visibleSlashMenu();
		},
		setSlashMenu,
		get filteredCommands() {
			return filteredCommands();
		},
		get showCommands() {
			return visibleSlashMenu().show;
		},
		get slashCommandNames() {
			return slashCommandNames();
		},
		handleInputForFileMenu: (value: string, cursor: number) =>
			handleInput(value, cursor, "@", setFileMenu),
		handleInputForSlashMenu: (value: string, cursor: number) =>
			handleInput(value, cursor, "/", setSlashMenu),
		selectCommand: (index: number) => select("command", index),
		selectFile: (index: number) => select("file", index),
	};
}
export function useAgentChatSettings(
	_paneId: Accessor<string>,
	_agentKind: Accessor<WorkspaceAgentKind>,
) {
	const [selection, setSelection] = createSignal<ProviderConfigSelection>({
		model: "",
		reasoningLevel: "",
	});
	const [configurationError, setConfigurationError] = createSignal<
		string | null
	>(null);
	let requestRevision = 0;
	let requests = Promise.resolve();
	let scopeVersion = 0;
	const resolveSelection = (
		patch: Partial<ReturnType<typeof selection>> = {},
		identity = { paneId: _paneId(), agentKind: _agentKind() },
	) => {
		const revision = ++requestRevision;
		const version = scopeVersion;
		const target = { ...identity, ...patch };
		requests = requests.then(async () => {
			if (version !== scopeVersion) return;
			try {
				const resolved = await resolveProviderConfig(target);
				if (revision !== requestRevision || version !== scopeVersion) return;
				setSelection(resolved);
				setConfigurationError(null);
			} catch (error) {
				if (revision === requestRevision && version === scopeVersion)
					setConfigurationError(
						`Could not update chat settings: ${String(error)}`,
					);
			}
		});
	};
	const settingsIdentity = createMemo(() =>
		JSON.stringify([_paneId(), _agentKind()]),
	);
	createEffect(settingsIdentity, (key) => {
		scopeVersion++;
		const [paneId, agentKind] = JSON.parse(key);
		resolveSelection({}, { paneId, agentKind });
		return () => {
			scopeVersion++;
			requestRevision++;
		};
	});
	const agentKindOptions = createMemo(() =>
		(["claude", "codex"] as const).map((id) => ({
			id,
			label: getAgentDefinition(id).label,
		})),
	);
	return {
		get configurationError() {
			return configurationError();
		},
		get agentKindOptions() {
			return agentKindOptions();
		},
		get effectiveSelectedModel() {
			return selection().model;
		},
		get selectedReasoningLevel() {
			return selection().reasoningLevel;
		},
		handleAgentKindChange: (kind: WorkspaceAgentKind) =>
			changePaneAgentKind(_paneId(), kind),
		handleModelChange: (model: string) => resolveSelection({ model }),
		handleReasoningLevelChange: (reasoningLevel: string) =>
			resolveSelection({ reasoningLevel }),
	};
}
export function hideMenuState<
	S extends {
		show: boolean;
	},
>(state: S): S {
	return { ...state, show: false };
}
