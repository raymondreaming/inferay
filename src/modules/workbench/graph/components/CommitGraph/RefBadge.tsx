import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import type { GitGraphRefKind } from "../../../../../../build/presentation/contracts/GitGraphRefKind.ts";
import { palette } from "../../../../../design-system/styles.stylex.ts";
import { domStyle } from "../../../../../shared/lib/dom.tsx";
import { RefIcon } from "./RefIcon.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
import { hexToRgba } from "./useCommitGraphState.tsx";

function refKindLabel(kind: GitGraphRefKind): string {
	if (kind === "head") return "current local branch";
	if (kind === "localBranch") return "local branch";
	if (kind === "remoteBranch") return "remote branch";
	if (kind === "tag") return "tag";
	return "stash";
}
export function RefBadge(_props: {
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
	const [hovered, setHovered] = createSignal(false);
	const interactive = createMemo(
		() =>
			(_props.kind === "localBranch" ||
				(_props.kind === "head" &&
					_props.fullName.startsWith("refs/heads/"))) &&
			!!(_props.onCheckout || _props.onRefDrop),
	);
	const keyboardActionable = createMemo(
		() => interactive() || Boolean(_props.onOpenContextMenu),
	);
	const kindLabel = createMemo(() => refKindLabel(_props.kind));
	return (
		<span
			role={keyboardActionable() ? "button" : undefined}
			data-ref-kind={_props.kind}
			data-ref-ghost={
				(_props.ghost === undefined ? false : _props.ghost) ? "true" : undefined
			}
			data-ref-hovered={hovered() ? "true" : "false"}
			tabindex={keyboardActionable() ? 0 : undefined}
			draggable={interactive() ? "true" : "false"}
			title={
				(_props.ghost === undefined ? false : _props.ghost)
					? `${_props.label} — nearest containing ${kindLabel()}${interactive() ? "; double-click to check out" : ""}`
					: _props.worktreePath
						? `${_props.label} — ${kindLabel()}; checked out at ${_props.worktreePath}`
						: _props.upstream
							? `${_props.label} — ${kindLabel()}; tracks ${_props.upstream}`
							: interactive()
								? `${_props.label} — ${kindLabel()}; double-click to check out`
								: `${_props.label} — ${kindLabel()}`
			}
			onDblClick={(event) => {
				if (!interactive()) return;
				event.preventDefault();
				event.stopPropagation();
				_props.onCheckout?.(_props.label);
			}}
			onClick={(event) => {
				if (keyboardActionable()) event.stopPropagation();
			}}
			onKeyDown={(event) => {
				if (interactive() && event.key === "Enter") {
					event.preventDefault();
					event.stopPropagation();
					_props.onCheckout?.(_props.label);
					return;
				}
				if (
					_props.onOpenContextMenu &&
					(event.key === "ContextMenu" ||
						(event.shiftKey && event.key === "F10"))
				) {
					event.preventDefault();
					event.stopPropagation();
					const bounds = event.currentTarget.getBoundingClientRect();
					_props.onOpenContextMenu(
						new MouseEvent("contextmenu", {
							clientX: bounds.left + bounds.width / 2,
							clientY: bounds.bottom,
						}),
					);
				}
			}}
			onDragStart={(event) => {
				if (!interactive() || !event.dataTransfer) return;
				event.stopPropagation();
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData(
					"application/x-inferay-git-ref",
					_props.fullName,
				);
				event.dataTransfer.setData("text/plain", _props.label);
			}}
			onDragOver={(event) => {
				if (!interactive() || !event.dataTransfer) return;
				const source = event.dataTransfer.getData(
					"application/x-inferay-git-ref",
				);
				if (!source || source === _props.fullName) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
			}}
			onDrop={(event) => {
				if (!interactive() || !event.dataTransfer) return;
				const source = event.dataTransfer.getData(
					"application/x-inferay-git-ref",
				);
				if (!source || source === _props.fullName) return;
				event.preventDefault();
				event.stopPropagation();
				_props.onRefDrop?.(
					source.replace(/^refs\/heads\//, ""),
					_props.fullName.replace(/^refs\/heads\//, ""),
				);
			}}
			onContextMenu={(event) => {
				if (!_props.onOpenContextMenu) return;
				event.preventDefault();
				event.stopPropagation();
				_props.onOpenContextMenu(event);
			}}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocus={() => setHovered(true)}
			onBlur={() => setHovered(false)}
			{...stylex.attrs(
				styles.refBadge,
				(_props.kind !== "head" ||
					(_props.ghost === undefined ? false : _props.ghost)) &&
					styles.dimmedRefBadge,
				(_props.ghost === undefined ? false : _props.ghost) &&
					styles.ghostRefBadge,
			)}
			style={domStyle(
				inlineStyles.getRefBadgeRefBadgeStyle(
					(_props.ghost === undefined ? false : _props.ghost)
						? hexToRgba(_props.color, hovered() ? 0.18 : 0.055)
						: hexToRgba(_props.color, hovered() ? 0.75 : 0.5),
					(_props.ghost === undefined ? false : _props.ghost)
						? _props.color
						: palette.white,
				),
			)}
		>
			<RefIcon kind={_props.kind} />
			<span {...stylex.attrs(styles.truncate)}>{_props.label}</span>
			{
				<For
					each={_props.trailingKinds === undefined ? [] : _props.trailingKinds}
					keyed={(row) => row}
				>
					{(trailingKind, index) => (
						<span aria-hidden="true" {...stylex.attrs(styles.shrink)}>
							<RefIcon kind={trailingKind()} />
						</span>
					)}
				</For>
			}
		</span>
	);
}
