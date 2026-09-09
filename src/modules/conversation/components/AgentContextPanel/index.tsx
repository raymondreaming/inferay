import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
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
	const [isSaving, setIsSaving] = createSignal(false);
	const [error, setError] = createSignal("");
	const save = async () => {
		if (isSaving() || _source.isLoading) return false;
		setIsSaving(true);
		setError("");
		try {
			await _source.save(scope(), instructions(), "inherit");
			return true;
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Unable to save instructions",
			);
			return false;
		} finally {
			setIsSaving(false);
		}
	};
	const close = async () => {
		if (_source.isLoading || (await save())) _props.onClose();
	};
	const folderName = createMemo(() =>
		_props.cwd
			? _props.cwd.replace(/\/+$/, "").split("/").pop() || _props.cwd
			: "Folder",
	);
	createEffect(
		() => [_props.onClose],
		() => {
			const handleKeyDown = (event: KeyboardEvent) => {
				if (event.key === "Escape") void close();
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
					onClick={() => void close()}
					disabled={isSaving()}
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
								disabled={isSaving()}
								onClick={async () => {
									const next = item();
									if (next !== scope() && (await save())) setScope(next);
								}}
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
					disabled={isSaving() || _source.isLoading}
					onInput={(event) => {
						const next = event.currentTarget.value;
						setInstructions(next);
					}}
					placeholder={
						scope() === "chat"
							? "Instructions for this chat"
							: `Instructions for ${folderName()}`
					}
					{...stylex.attrs(styles.editor)}
				/>
				<p {...stylex.attrs(styles.fieldLabel)}>
					Applied silently when a chat starts. Start a new chat to use changed
					instructions.
				</p>
				<Button
					variant="secondary"
					size="sm"
					liquid={false}
					disabled={isSaving() || _source.isLoading}
					onClick={() => void save()}
				>
					{isSaving() ? "Saving…" : "Save instructions"}
				</Button>
				{(error() || _source.error) && (
					<p role="alert">{error() || _source.error}</p>
				)}
			</div>
		</div>
	);
}
