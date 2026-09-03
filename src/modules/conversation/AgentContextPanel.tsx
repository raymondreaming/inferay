import * as stylex from "@octanejs/stylex";
import { useEffect, useRef, useState } from "octane";
import { useAgentContext } from "../../modules/context/useAgentContext.tsx";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";

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

const styles = stylex.create({
	panel: {
		backgroundColor: color.transparent,
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minHeight: controlSize._0,
		overflow: "hidden",
		width: "100%",
	},
	scopeRow: {
		alignItems: "center",
		borderBottomColor: color.borderSubtle,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._1,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	scopeButton: {
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		cursor: "pointer",
		fontSize: font.size_1,
		height: controlSize._6,
		paddingInline: controlSize._2,
		transitionDuration: motion.durationFast,
		transitionProperty: "background-color, border-color, color",
	},
	scopeButtonActive: {
		backgroundColor: color.surfaceControl,
		borderColor: color.border,
		color: color.textMain,
	},
	body: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		gap: controlSize._2,
		minHeight: controlSize._0,
		padding: controlSize._3,
	},
	fieldLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	editor: {
		backgroundColor: color.surfaceInset,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		lineHeight: 1.5,
		flex: 1,
		minHeight: 180,
		outline: "none",
		padding: controlSize._2_5,
		resize: "none",
		":focus": {
			borderColor: color.borderStrong,
			boxShadow: shadow.focusRing,
		},
	},
});
