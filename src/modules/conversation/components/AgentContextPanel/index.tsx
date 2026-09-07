import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import { IconArrowLeft } from "../../../../shared/ui/Icons/index.tsx";
import { useAgentContext } from "../../../context/hooks/useAgentContext.tsx";
import { styles } from "./styles.ts";

type Scope = "project" | "chat";
export function AgentContextPanel(_props: {
	paneId: string;
	cwd?: string;
	onClose: () => void;
}) {
	const _source = useAgentContext(
		() => _props.paneId,
		() => _props.cwd,
	);
	const [scope, setScope] = createSignal<Scope>(
		_props.cwd ? "project" : "chat",
	);
	const layer = createMemo(() =>
		scope() === "project" ? _source.context.project : _source.context.chat,
	);
	const [instructions, setInstructions] = createSignal(
		() => layer()?.instructions ?? "",
	);
	const saveTimerRef = {
		current: null,
	} as {
		current: ReturnType<typeof setTimeout> | null;
	};
	const folderName = createMemo(() =>
		_props.cwd
			? _props.cwd.replace(/\/+$/, "").split("/").pop() || _props.cwd
			: "Folder",
	);
	const scheduleSave = (nextInstructions: string) => {
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => {
			saveTimerRef.current = null;
			void _source.save(scope(), nextInstructions, "inherit");
		}, 500);
	};
	createEffect(
		() => [_props.onClose],
		() => {
			const handleKeyDown = (event: KeyboardEvent) => {
				if (event.key === "Escape") _props.onClose();
			};
			document.addEventListener("keydown", handleKeyDown);
			return () => {
				document.removeEventListener("keydown", handleKeyDown);
			};
		},
	);
	const scopes = createMemo<Scope[]>(() => [
		...(_props.cwd ? (["project"] as const) : []),
		"chat",
	]);
	return (
		<div {...stylex.attrs(styles.panel)}>
			<div {...stylex.attrs(styles.scopeRow)}>
				<IconButton
					type="button"
					onClick={_props.onClose}
					variant="ghost"
					size="sm"
					title="Back to chat"
					aria-label="Back to chat"
				>
					<IconArrowLeft size={iconSize.md} />
				</IconButton>
				<span {...stylex.attrs(styles.scopeDivider)} />
				{
					<For each={scopes()} keyed={(row) => row}>
						{(item) => (
							<button
								type="button"
								onClick={() => setScope(item())}
								{...stylex.attrs(
									styles.scopeButton,
									scope() === item() && styles.scopeButtonActive,
								)}
								title={item() === "project" ? _props.cwd : undefined}
							>
								{item() === "chat" ? "This chat" : folderName()}
							</button>
						)}
					</For>
				}
			</div>

			<div {...stylex.attrs(styles.body)}>
				<span {...stylex.attrs(styles.fieldLabel)}>Agent Instructions</span>
				<textarea
					value={instructions()}
					onInput={(event) => {
						const next = event.currentTarget.value;
						setInstructions(next);
						scheduleSave(next);
					}}
					placeholder={
						scope() === "chat"
							? "Instructions for this chat"
							: `Instructions for ${folderName()}`
					}
					{...stylex.attrs(styles.editor)}
				/>
			</div>
		</div>
	);
}
