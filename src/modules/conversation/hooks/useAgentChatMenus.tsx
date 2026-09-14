import type { SlashCommand, WorkspaceAgentKind } from "@contracts";
import {
	type ChatFileSearchResult,
	loadAgentCommands,
	type ProviderConfigSelection,
	resolveProviderConfig,
	searchChatFiles,
} from "@conversation/services/conversationApi.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import type { RefCell } from "@shared/lib/dom.tsx";
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
export interface FileMenuState {
	show: boolean;
	selectedIdx: number;
	query: string;
	atIndex: number;
}
export interface SlashMenuState {
	show: boolean;
	selectedIdx: number;
	query: string;
	slashIndex: number;
}
export type FileSearchResult = ChatFileSearchResult;
interface UseAgentChatMenusOptions {
	agentKind: WorkspaceAgentKind;
	cwd?: string;
	enabled?: boolean;
	input: string;
	setInput: (value: string) => void;
	textareaRef: RefCell<HTMLTextAreaElement | null>;
}
function showCompletion<Key extends "atIndex" | "slashIndex">(
	previous: {
		show: boolean;
		selectedIdx: number;
		query: string;
	} & Record<Key, number>,
	key: Key,
	trigger: {
		index: number;
		query: string;
	},
) {
	return previous.show &&
		previous.selectedIdx === 0 &&
		previous.query === trigger.query &&
		previous[key] === trigger.index
		? previous
		: {
				...previous,
				show: true,
				selectedIdx: 0,
				query: trigger.query,
				[key]: trigger.index,
			};
}
export function useAgentChatMenus(
	_options: Accessor<UseAgentChatMenusOptions>,
) {
	const enabled = createMemo(() => _options().enabled !== false);
	const [fileMenu, setFileMenu] = createSignal<FileMenuState>({
		show: false,
		selectedIdx: 0,
		query: "",
		atIndex: -1,
	});
	const [slashMenu, setSlashMenu] = createSignal<SlashMenuState>({
		show: false,
		selectedIdx: 0,
		query: "",
		slashIndex: -1,
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
	const filteredCommands = createMemo(() => {
		const _slashMenuValue = slashMenu();
		if (!_slashMenuValue.show || _slashMenuValue.slashIndex === -1) {
			return [] as SlashCommand[];
		}
		const query = _slashMenuValue.query.toLowerCase();
		return _source.data.filter((cmd) =>
			cmd.name.toLowerCase().startsWith(query),
		);
	});
	const visibleFileMenu = createMemo(() =>
		enabled() ? fileMenu() : hideMenuState(fileMenu()),
	);
	const visibleSlashMenu = createMemo(() =>
		enabled() ? slashMenu() : hideMenuState(slashMenu()),
	);
	const handleInputForSlashMenu = (value: string, cursorPos: number) => {
		if (!enabled()) return;
		const trigger = findTriggerAtCursor(value, cursorPos, "/");
		if (!trigger) {
			setSlashMenu((prev) => (prev.show ? hideMenuState(prev) : prev));
			return;
		}
		setSlashMenu((previous) => showCompletion(previous, "slashIndex", trigger));
	};
	const handleInputForFileMenu = (value: string, cursorPos: number) => {
		if (!enabled()) return;
		const trigger = findTriggerAtCursor(value, cursorPos, "@");
		if (!trigger) {
			setFileMenu((prev) => (prev.show ? hideMenuState(prev) : prev));
			return;
		}
		setFileMenu((previous) => showCompletion(previous, "atIndex", trigger));
	};
	const complete = (index: number, replacement: string, hide: () => void) => {
		const _optionsValue9 = _options();
		const cursor =
			_optionsValue9.textareaRef.current?.selectionStart ??
			_optionsValue9.input.length;
		const { nextValue, nextCursor } = rustProject<{
			nextValue: string;
			nextCursor: number;
		}>("completion", {
			input: _optionsValue9.input,
			cursorPos: cursor,
			triggerIndex: index,
			replacement,
		});
		_optionsValue9.setInput(nextValue);
		hide();
		requestAnimationFrame(() => {
			const textarea = _options().textareaRef.current;
			if (!textarea) return;
			textarea.focus();
			textarea.setSelectionRange(nextCursor, nextCursor);
		});
	};
	const selectCommand = (index: number) => {
		const command = filteredCommands()[index];
		if (command)
			complete(slashMenu().slashIndex, `/${command.name}`, () =>
				setSlashMenu(hideMenuState),
			);
	};
	const selectFile = (index: number) => {
		const file = _source2.data[index];
		if (file)
			complete(fileMenu().atIndex, `@${file.path}`, () =>
				setFileMenu(hideMenuState),
			);
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
		handleInputForFileMenu,
		handleInputForSlashMenu,
		selectCommand,
		selectFile,
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
				if (revision !== requestRevision) return;
				setSelection(resolved);
				setConfigurationError(null);
			} catch (error) {
				if (revision === requestRevision)
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
export function findTriggerAtCursor(
	value: string,
	cursorPos: number,
	trigger: "/" | "@",
): {
	index: number;
	query: string;
} | null {
	return rustProject("trigger", {
		value,
		cursorPos,
		trigger,
	});
}
export function hideMenuState<
	S extends {
		show: boolean;
	},
>(state: S): S {
	return {
		...state,
		show: false,
	};
}
