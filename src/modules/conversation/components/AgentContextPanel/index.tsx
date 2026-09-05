import * as stylex from "@octanejs/stylex";
import { useEffect, useRef, useState } from "octane";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import { IconArrowLeft } from "../../../../shared/ui/Icons/index.tsx";
import { useAgentContext } from "../../../context/hooks/useAgentContext.tsx";
import { styles } from "./styles.ts";

type Scope = "project" | "chat";

export function AgentContextPanel({
	paneId,
	cwd,
	onClose,
}: {
	paneId: string;
	cwd?: string;
	onClose: () => void;
}) {
	const { context, save } = useAgentContext(paneId, cwd);
	const [scope, setScope] = useState<Scope>(cwd ? "project" : "chat");
	const layer = scope === "project" ? context.project : context.chat;
	const [instructions, setInstructions] = useState("");
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const folderName = cwd
		? cwd.replace(/\/+$/, "").split("/").pop() || cwd
		: "Folder";

	useEffect(() => {
		setInstructions(layer?.instructions ?? "");
	}, [layer, scope]);

	const scheduleSave = (nextInstructions: string) => {
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => {
			saveTimerRef.current = null;
			void save(scope, nextInstructions, "inherit");
		}, 500);
	};

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [onClose]);

	const scopes: Scope[] = [...(cwd ? (["project"] as const) : []), "chat"];

	return (
		<div {...stylex.props(styles.panel)}>
			<div {...stylex.props(styles.scopeRow)}>
				<IconButton
					type="button"
					onClick={onClose}
					variant="ghost"
					size="sm"
					title="Back to chat"
					aria-label="Back to chat"
				>
					<IconArrowLeft size={iconSize.md} />
				</IconButton>
				<span {...stylex.props(styles.scopeDivider)} />
				{scopes.map((item) => (
					<button
						type="button"
						key={item}
						onClick={() => setScope(item)}
						{...stylex.props(
							styles.scopeButton,
							scope === item && styles.scopeButtonActive,
						)}
						title={item === "project" ? cwd : undefined}
					>
						{item === "chat" ? "This chat" : folderName}
					</button>
				))}
			</div>

			<div {...stylex.props(styles.body)}>
				<span {...stylex.props(styles.fieldLabel)}>Agent Instructions</span>
				<textarea
					value={instructions}
					onInput={(event) => {
						const next = event.currentTarget.value;
						setInstructions(next);
						scheduleSave(next);
					}}
					placeholder={
						scope === "chat"
							? "Instructions for this chat"
							: `Instructions for ${folderName}`
					}
					{...stylex.props(styles.editor)}
				/>
			</div>
		</div>
	);
}
