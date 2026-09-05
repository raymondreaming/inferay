import * as stylex from "@octanejs/stylex";
import { useState } from "octane";
import { palette } from "../../../../../design-system/styles.stylex.ts";
import type { GitGraphRefKind } from "../../../../repository/hooks/useGitGraph";
import { RefIcon } from "./RefIcon.tsx";
import { hexToRgba } from "./shared.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

function refKindLabel(kind: GitGraphRefKind): string {
	if (kind === "head") return "current local branch";
	if (kind === "localBranch") return "local branch";
	if (kind === "remoteBranch") return "remote branch";
	if (kind === "tag") return "tag";
	return "stash";
}

export function RefBadge({
	label,
	fullName,
	color,
	kind,
	onCheckout,
	onRefDrop,
	worktreePath,
	upstream,
	trailingKinds = [],
	onOpenContextMenu,
	ghost = false,
}: {
	label: string;
	fullName: string;
	color: string;
	kind: GitGraphRefKind;
	onCheckout?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	worktreePath?: string;
	upstream?: string;
	trailingKinds?: GitGraphRefKind[];
	onOpenContextMenu?: (event: MouseEvent) => void;
	ghost?: boolean;
}) {
	const [hovered, setHovered] = useState(false);
	const interactive =
		(kind === "localBranch" ||
			(kind === "head" && fullName.startsWith("refs/heads/"))) &&
		!!(onCheckout || onRefDrop);
	const keyboardActionable = interactive || Boolean(onOpenContextMenu);
	const kindLabel = refKindLabel(kind);
	return (
		<span
			role={keyboardActionable ? "button" : undefined}
			data-ref-kind={kind}
			data-ref-ghost={ghost ? "true" : undefined}
			data-ref-hovered={hovered ? "true" : "false"}
			tabIndex={keyboardActionable ? 0 : undefined}
			draggable={interactive}
			title={
				ghost
					? `${label} — nearest containing ${kindLabel}${interactive ? "; double-click to check out" : ""}`
					: worktreePath
						? `${label} — ${kindLabel}; checked out at ${worktreePath}`
						: upstream
							? `${label} — ${kindLabel}; tracks ${upstream}`
							: interactive
								? `${label} — ${kindLabel}; double-click to check out`
								: `${label} — ${kindLabel}`
			}
			onDoubleClick={(event) => {
				if (!interactive) return;
				event.preventDefault();
				event.stopPropagation();
				onCheckout?.(label);
			}}
			onClick={(event) => {
				if (keyboardActionable) event.stopPropagation();
			}}
			onKeyDown={(event) => {
				if (interactive && event.key === "Enter") {
					event.preventDefault();
					event.stopPropagation();
					onCheckout?.(label);
					return;
				}
				if (
					onOpenContextMenu &&
					(event.key === "ContextMenu" ||
						(event.shiftKey && event.key === "F10"))
				) {
					event.preventDefault();
					event.stopPropagation();
					const bounds = event.currentTarget.getBoundingClientRect();
					onOpenContextMenu(
						new MouseEvent("contextmenu", {
							clientX: bounds.left + bounds.width / 2,
							clientY: bounds.bottom,
						}),
					);
				}
			}}
			onDragStart={(event) => {
				if (!interactive || !event.dataTransfer) return;
				event.stopPropagation();
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("application/x-inferay-git-ref", fullName);
				event.dataTransfer.setData("text/plain", label);
			}}
			onDragOver={(event) => {
				if (!interactive || !event.dataTransfer) return;
				const source = event.dataTransfer.getData(
					"application/x-inferay-git-ref",
				);
				if (!source || source === fullName) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
			}}
			onDrop={(event) => {
				if (!interactive || !event.dataTransfer) return;
				const source = event.dataTransfer.getData(
					"application/x-inferay-git-ref",
				);
				if (!source || source === fullName) return;
				event.preventDefault();
				event.stopPropagation();
				onRefDrop?.(
					source.replace(/^refs\/heads\//, ""),
					fullName.replace(/^refs\/heads\//, ""),
				);
			}}
			onContextMenu={(event) => {
				if (!onOpenContextMenu) return;
				event.preventDefault();
				event.stopPropagation();
				onOpenContextMenu(event);
			}}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocus={() => setHovered(true)}
			onBlur={() => setHovered(false)}
			{...stylex.props(
				styles.refBadge,
				(kind !== "head" || ghost) && styles.dimmedRefBadge,
				ghost && styles.ghostRefBadge,
			)}
			style={inlineStyles.getRefBadgeRefBadgeStyle(
				ghost
					? hexToRgba(color, hovered ? 0.18 : 0.055)
					: hexToRgba(color, hovered ? 0.75 : 0.5),
				ghost ? color : palette.white,
			)}
		>
			<RefIcon kind={kind} />
			<span {...stylex.props(styles.truncate)}>{label}</span>
			{trailingKinds.map((trailingKind, index) => (
				<span
					key={`${trailingKind}:${index}`}
					aria-hidden="true"
					{...stylex.props(styles.shrink)}
				>
					<RefIcon kind={trailingKind} />
				</span>
			))}
		</span>
	);
}
