import type { ComposerConfigControl, WorkspaceAgentKind } from "@contracts";
import type { RefCell } from "@shared/lib/dom.tsx";
import { getAgentDefinition, project } from "@shared/lib/native.tsx";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
} from "solid-js";
export function useAgentConfiguration(
	_props: Accessor<{
		agentKind: WorkspaceAgentKind;
		agentKindOptions: { id: WorkspaceAgentKind; label: string }[];
		model: string;
		reasoningLevel: string;
		onAgentKindChange: (kind: WorkspaceAgentKind) => void;
		onModelChange: (model: string) => void;
		onReasoningLevelChange: (level: string) => void;
		onAgentConfigOpenChange?: (open: boolean) => void;
	}>,
) {
	const agentConfigControlsRef: RefCell<HTMLDivElement | null> = {
		current: null,
	};
	const agentConfigButtonRef: RefCell<HTMLButtonElement | null> = {
		current: null,
	};
	const agentConfigMenuRef: RefCell<HTMLDivElement | null> = {
		current: null,
	};
	const [activeConfig, setActiveConfig] = createSignal<string | null>(null);
	const agentConfigOpen = createMemo(() => activeConfig() !== null);
	createEffect(
		() => [agentConfigOpen(), _props().onAgentConfigOpenChange] as const,
		([open, notify]) => {
			notify?.(open);
		},
	);
	createEffect(
		() => _props().onAgentConfigOpenChange,
		(notify) => () => notify?.(false),
	);
	const configControls = createMemo(() => {
		const props = _props();
		const { label, models, reasoningLevels } = getAgentDefinition(
			props.agentKind,
		);
		const changes = {
			provider: (id: string) =>
				_props().onAgentKindChange(id as WorkspaceAgentKind),
			model: props.onModelChange,
			reasoning: props.onReasoningLevelChange,
		};
		return project<ComposerConfigControl[]>("composerConfig", {
			definition: { label, models, reasoningLevels },
			agentKind: props.agentKind,
			agentKindOptions: props.agentKindOptions,
			model: props.model,
			reasoningLevel: props.reasoningLevel,
		}).map((control) => ({ ...control, onChange: changes[control.id] }));
	});
	const activeControl = createMemo(() =>
		configControls().find((control) => control.id === activeConfig()),
	);
	createEffect(
		() => agentConfigOpen(),
		(open) => {
			if (!open) return;
			const handlePointerDown = (event: MouseEvent) => {
				const target = event.target as Node;
				if (
					agentConfigMenuRef.current?.contains(target) ||
					agentConfigControlsRef.current?.contains(target)
				)
					return;
				setActiveConfig(null);
			};
			const handleKeyDown = (event: KeyboardEvent) => {
				if (event.key === "Escape") {
					setActiveConfig(null);
					agentConfigButtonRef.current?.focus();
				}
			};
			document.addEventListener("mousedown", handlePointerDown);
			document.addEventListener("keydown", handleKeyDown);
			return () => {
				document.removeEventListener("mousedown", handlePointerDown);
				document.removeEventListener("keydown", handleKeyDown);
			};
		},
	);
	createEffect(
		() => activeConfig(),
		(active) => {
			if (!active) return;
			const menu = agentConfigMenuRef.current;
			(
				menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
				menu?.querySelector<HTMLButtonElement>("button")
			)?.focus();
		},
	);
	return {
		agentConfigControlsRef,
		agentConfigButtonRef,
		agentConfigMenuRef,
		setActiveConfig,
		get activeConfig() {
			return activeConfig();
		},
		get configControls() {
			return configControls();
		},
		get activeControl() {
			return activeControl();
		},
	};
}
