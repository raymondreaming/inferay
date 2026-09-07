import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
} from "solid-js";
import type { SlashCommand } from "../../../../build/presentation/contracts/SlashCommand.ts";
import type { WorkspaceAgentKind } from "../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import { useQueryResource } from "../../../shared/hooks/useQueryResource.tsx";
import type { RefCell } from "../../../shared/lib/dom.tsx";
import {
	fetchJson,
	fetchJsonOr,
	getAgentDefinition,
	postJson,
	project as rustProject,
} from "../../../shared/lib/native.tsx";
import { getAgentIcon } from "../../agents/components/AgentIcon/index.tsx";
import { changePaneAgentKind } from "../../workspace/hooks/useWorkspaceState.tsx";
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
export interface FileSearchResult {
	name: string;
	path: string;
	isDir: boolean;
}
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
		() => (signal) =>
			fetchJson<SlashCommand[]>(
				`/api/agent/commands?kind=${_options().agentKind}`,
				{
					signal,
				},
			),
		() => getAgentDefinition(_options().agentKind).commands,
		() => {
			const _optionsValue = _options();
			return {
				queryKey: ["skills", "commands", _optionsValue.agentKind],
				enabled:
					_optionsValue.enabled === undefined ? true : _optionsValue.enabled,
			};
		},
	);
	const _source2 = useQueryResource(
		() => async (signal) => {
			const _optionsValue2 = _options();
			await new Promise((resolve) => setTimeout(resolve, 150));
			signal?.throwIfAborted();
			const params = new URLSearchParams({
				q: fileMenu().query,
				limit: "15",
			});
			if (_optionsValue2.cwd) params.set("cwd", _optionsValue2.cwd);
			const data = await fetchJsonOr<{
				results?: FileSearchResult[];
			}>(
				`/api/files/search?${params}`,
				{},
				{
					signal,
				},
			);
			return data.results ?? [];
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
				enabled:
					(_optionsValue3.enabled === undefined
						? true
						: _optionsValue3.enabled) && _fileMenuValue.show,
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
	const visibleFileMenu = createMemo(() => {
		const _optionsValue4 = _options(),
			_fileMenuValue2 = fileMenu();
		return (
			_optionsValue4.enabled === undefined
				? true
				: _optionsValue4.enabled
		)
			? _fileMenuValue2
			: hideMenuState(_fileMenuValue2);
	});
	const visibleSlashMenu = createMemo(() => {
		const _optionsValue5 = _options(),
			_slashMenuValue2 = slashMenu();
		return (
			_optionsValue5.enabled === undefined
				? true
				: _optionsValue5.enabled
		)
			? _slashMenuValue2
			: hideMenuState(_slashMenuValue2);
	});
	const showCommands = createMemo(() => {
		const _optionsValue6 = _options();
		return (
			(_optionsValue6.enabled === undefined ? true : _optionsValue6.enabled) &&
			visibleSlashMenu().show
		);
	});
	const handleInputForSlashMenu = (value: string, cursorPos: number) => {
		const _optionsValue7 = _options();
		if (!(_optionsValue7.enabled === undefined ? true : _optionsValue7.enabled))
			return;
		const trigger = findTriggerAtCursor(value, cursorPos, "/");
		if (!trigger) {
			setSlashMenu((prev) => (prev.show ? hideMenuState(prev) : prev));
			return;
		}
		setSlashMenu((previous) => showCompletion(previous, "slashIndex", trigger));
	};
	const handleInputForFileMenu = (value: string, cursorPos: number) => {
		const _optionsValue8 = _options();
		if (!(_optionsValue8.enabled === undefined ? true : _optionsValue8.enabled))
			return;
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
		get setFileMenu() {
			return setFileMenu;
		},
		get fileResults() {
			return _source2.data;
		},
		get slashMenu() {
			return visibleSlashMenu();
		},
		get setSlashMenu() {
			return setSlashMenu;
		},
		get filteredCommands() {
			return filteredCommands();
		},
		get showCommands() {
			return showCommands();
		},
		get slashCommandNames() {
			return slashCommandNames();
		},
		get handleInputForFileMenu() {
			return handleInputForFileMenu;
		},
		get handleInputForSlashMenu() {
			return handleInputForSlashMenu;
		},
		get selectCommand() {
			return selectCommand;
		},
		get selectFile() {
			return selectFile;
		},
	};
}
export function useAgentChatSettings(
	_paneId: Accessor<string>,
	_agentKind: Accessor<WorkspaceAgentKind>,
) {
	const [selection, setSelection] = createSignal({
		model: "",
		reasoningLevel: "",
	});
	const [configurationError, setConfigurationError] = createSignal<
		string | null
	>(null);
	const requestRevision = {
		current: 0,
	};
	const requests = {
		current: Promise.resolve(),
	};
	const resolveSelection = (
		patch: Partial<ReturnType<typeof selection>> = {},
	) => {
		const revision = ++requestRevision.current;
		requests.current = requests.current.then(async () => {
			try {
				const resolved = await postJson<ReturnType<typeof selection>>(
					"/api/native/provider-config",
					{
						paneId: _paneId(),
						agentKind: _agentKind(),
						...patch,
					},
				);
				if (revision !== requestRevision.current) return;
				setSelection(resolved);
				setConfigurationError(null);
			} catch (error) {
				if (revision === requestRevision.current)
					setConfigurationError(
						`Could not update chat settings: ${String(error)}`,
					);
			}
		});
	};
	createEffect(
		() => [resolveSelection, _paneId(), _agentKind()],
		() => {
			resolveSelection();
			return () => {
				requestRevision.current++;
			};
		},
	);
	const agentKindOptions = createMemo(() =>
		(["claude", "codex"] as const).map((id) => ({
			id,
			label: getAgentDefinition(id).label,
			icon: getAgentIcon(id, 11),
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
			const _selectionValue = selection();
			return _selectionValue.model;
		},
		get selectedReasoningLevel() {
			const _selectionValue = selection();
			return _selectionValue.reasoningLevel;
		},
		get handleAgentKindChange() {
			return (kind: WorkspaceAgentKind) => changePaneAgentKind(_paneId(), kind);
		},
		get handleModelChange() {
			return (model: string) =>
				resolveSelection({
					model,
				});
		},
		get handleReasoningLevelChange() {
			return (reasoningLevel: string) =>
				resolveSelection({
					reasoningLevel,
				});
		},
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
