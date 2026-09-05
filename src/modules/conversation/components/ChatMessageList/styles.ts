import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import {
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
} from "../../../../design-system/styles.stylex.ts";

const CHAT_LIST_TOP_PADDING_PX = 16;

const CHAT_LIST_BOTTOM_PADDING_PX = 16;

const CHAT_LIST_INLINE_GUTTER = "clamp(0.75rem, 3vw, 1.25rem)";

export const styles = stylex.create({
	toolMuted: {
		color: color.textMuted,
	},
	toolAccent: {
		color: color.accent,
	},
	toolLink: {
		color: color.accent,
		textDecorationColor: {
			default: color.accentBorder,
			":hover": color.accent,
		},
		textDecorationLine: "underline",
	},
	checkpointCard: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		marginBlock: controlSize._1,
		overflow: "hidden",
	},
	goalCard: {
		alignItems: "flex-start",
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		gap: controlSize._2,
		marginBlock: controlSize._1,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2_5,
	},
	goalCardActive: {
		borderColor: color.accentBorder,
	},
	goalCardPaused: {
		borderColor: color.warningBorder,
	},
	goalCardComplete: {
		borderColor: color.successBorder,
	},
	goalIconSlot: {
		alignItems: "center",
		backgroundColor: color.surfaceControl,
		borderRadius: radius.sm,
		color: color.textMuted,
		display: "flex",
		flexShrink: 0,
		height: controlSize._6,
		justifyContent: "center",
		marginTop: controlSize._0_25,
		width: controlSize._6,
	},
	goalIconActive: {
		color: color.accent,
	},
	goalIconPaused: {
		color: color.warning,
	},
	goalIconComplete: {
		color: color.success,
	},
	goalCardBody: {
		minWidth: controlSize._0,
		flex: 1,
	},
	goalCardHeader: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
		minWidth: controlSize._0,
	},
	goalCardTitle: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		lineHeight: 1.35,
	},
	commandObjective: {
		color: color.accent,
		fontFamily: font.familyMono,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		lineHeight: 1.35,
		marginTop: controlSize._0_5,
		overflowWrap: "break-word",
	},
	goalTurns: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
		marginLeft: "auto",
		whiteSpace: "nowrap",
	},
	goalObjective: {
		color: color.textSoft,
		fontSize: font.size_3,
		lineHeight: 1.45,
		marginTop: controlSize._0_5,
		overflowWrap: "break-word",
	},
	goalDetail: {
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.45,
		marginTop: controlSize._0_5,
		overflowWrap: "break-word",
	},
	checkpointHeader: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._1,
		minHeight: controlSize._5,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1_5,
	},
	checkpointToggle: {
		alignItems: "center",
		color: color.textSoft,
		display: "flex",
		flex: 1,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		minWidth: controlSize._0,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "opacity",
		transitionTimingFunction: motion.ease,
		":hover": {
			opacity: 0.8,
		},
	},
	undoButton: {
		borderRadius: radius.sm,
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		paddingBlock: controlSize._0,
		paddingInline: controlSize._1,
		transitionDuration: motion.durationBase,
		transitionProperty: "color, opacity",
		transitionTimingFunction: motion.ease,
		":hover": {
			color: color.textSoft,
		},
		":disabled": {
			opacity: 0.4,
		},
	},
	revertedLabel: {
		borderRadius: radius.md,
		color: color.textMuted,
		fontSize: font.size_2,
		fontStyle: "italic",
		paddingBlock: controlSize._0_25,
		paddingInline: controlSize._1_5,
	},
	checkpointFiles: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		paddingBottom: controlSize._2,
		paddingInline: controlSize._2,
		paddingTop: controlSize._1,
	},
	checkpointFile: {
		alignItems: "center",
		display: "flex",
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		gap: controlSize._1_5,
		paddingInline: controlSize._1,
	},
	checkpointChevron: {
		flexShrink: 0,
		opacity: 0.4,
		transitionDuration: motion.durationBase,
		transitionProperty: "transform",
	},
	rotateClosed: {
		transform: "rotate(-90deg)",
	},
	checkpointIcon: {
		flexShrink: 0,
		opacity: 0.4,
		color: color.textMuted,
	},
	revertedIcon: {
		color: color.danger,
	},
	checkpointTitle: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		opacity: 0.8,
	},
	spacer: {
		flex: 1,
	},
	userRow: {
		display: "flex",
		justifyContent: "flex-end",
	},
	userBubble: {
		maxWidth: "85%",
		borderRadius: radius.lg,
		borderBottomRightRadius: radius.xs,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2_5,
	},
	userImages: {
		display: "flex",
		flexWrap: "wrap",
		gap: controlSize._2,
		marginBlock: controlSize._1,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._0_5,
	},
	userImageFrame: {
		position: "relative",
		display: "inline-flex",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._1,
		borderRadius: radius.sm,
		backgroundColor: "color-mix(in srgb, var(--color-inferay-bg) 78%, #f6efe4)",
		backgroundImage:
			"linear-gradient(135deg, rgba(255,255,255,0.26), rgba(255,255,255,0) 42%), repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0 1px, transparent 1px 6px)",
		boxShadow:
			"0 0 0 1px rgba(255,255,255,0.12), 0 10px 24px rgba(30, 18, 46, 0.22), 0 0 28px rgba(176, 143, 255, 0.12)",
		transform: "rotate(-1.5deg)",
		transitionDuration: motion.durationBase,
		transitionProperty: "box-shadow, transform",
		transitionTimingFunction: motion.ease,
		":hover": {
			boxShadow:
				"0 0 0 1px rgba(255,255,255,0.16), 0 12px 28px rgba(30, 18, 46, 0.28), 0 0 34px rgba(176, 143, 255, 0.18)",
			transform: "rotate(-0.5deg) translateY(-1px)",
		},
		"::before": {
			content: '""',
			position: "absolute",
			top: "-0.38rem",
			left: "24%",
			width: "2.6rem",
			height: "0.82rem",
			borderRadius: radius.xs,
			backgroundColor: color.reviewHighlight,
			backgroundImage:
				"linear-gradient(90deg, rgba(255,255,255,0.22), rgba(255,255,255,0))",
			boxShadow: "0 1px 4px rgba(0, 0, 0, 0.14)",
			transform: "rotate(4deg)",
			zIndex: layer.content,
		},
		"::after": {
			content: '""',
			position: "absolute",
			inset: controlSize._1,
			borderRadius: radius.xs,
			backgroundImage:
				"radial-gradient(circle at 22% 18%, rgba(255,255,255,0.22), transparent 25%), linear-gradient(180deg, rgba(185, 170, 255, 0.14), rgba(255, 205, 238, 0.08))",
			pointerEvents: "none",
		},
	},
	userImageFrameAlt: {
		transform: "rotate(1.25deg)",
		":hover": {
			transform: "rotate(0.4deg) translateY(-1px)",
		},
		"::before": {
			left: "auto",
			right: "18%",
			transform: "rotate(-5deg)",
		},
	},
	userImage: {
		display: "block",
		width: "clamp(5.5rem, 20vw, 8.5rem)",
		height: "clamp(4.25rem, 15vw, 6.5rem)",
		borderRadius: radius.xs,
		objectFit: "cover",
		filter: "saturate(0.88) contrast(0.96) brightness(1.05)",
	},
	userText: {
		whiteSpace: "pre-wrap",
		overflowWrap: "break-word",
		fontSize: font.size_3,
	},
	dot2: {
		animationDelay: "0.1s",
	},
	dot3: {
		animationDelay: "0.2s",
	},
	systemText: {
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
		margin: controlSize._0,
		textAlign: "center",
	},
	btwCard: {
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: color.accentBorder,
		borderRadius: radius.lg,
		backgroundColor: color.accentWash,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	btwHeader: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1_5,
		marginBottom: controlSize._1_5,
	},
	btwLabel: {
		color: color.accent,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		letterSpacing: "0.08em",
		textTransform: "uppercase",
	},
	btwQuestion: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
	},
	btwBody: {
		color: color.textSoft,
		fontSize: font.size_3,
		lineHeight: 1.6,
	},
	btwDots: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._0_5,
		paddingBlock: controlSize._1,
	},
	smallDot: {
		width: controlSize._1,
		height: controlSize._1,
		borderRadius: radius.pill,
		backgroundColor: color.accent,
		animationName: stylex.keyframes({
			"50%": {
				transform: "translateY(-2px)",
			},
		}),
		animationDuration: "0.6s",
		animationIterationCount: "infinite",
	},
	toolToggle: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_2,
		maxWidth: "100%",
		minWidth: controlSize._0,
	},
	toolName: {
		fontFamily: font.familyMono,
		fontSize: font.size_1,
	},
	toolSummary: {
		color: color.textMuted,
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	toolTimeline: {
		boxSizing: "border-box",
		marginInline: "auto",
		maxWidth: "34rem",
		minWidth: controlSize._0,
		width: "100%",
	},
	toolMilestone: {
		display: "grid",
		gridTemplateColumns: "0.75rem minmax(0, 1fr)",
		minWidth: controlSize._0,
		position: "relative",
	},
	toolMilestoneNode: {
		alignSelf: "stretch",
		position: "relative",
		"::before": {
			backgroundColor: color.background,
			borderColor: color.accentBorder,
			borderRadius: radius.pill,
			borderStyle: "solid",
			borderWidth: 1,
			boxShadow: "0 0 0 2px var(--color-inferay-black)",
			content: '""',
			height: controlSize._1_5,
			left: "50%",
			position: "absolute",
			top: "0.55rem",
			transform: "translateX(-50%)",
			width: controlSize._1_5,
			zIndex: layer.content,
		},
		"::after": {
			backgroundColor: color.borderStrong,
			bottom: "-0.74rem",
			content: '""',
			left: "50%",
			position: "absolute",
			top: "0.74rem",
			transform: "translateX(-50%)",
			width: controlSize._0_25,
		},
	},
	toolMilestoneNodeLast: {
		"::after": {
			display: "none",
		},
	},
	toolMilestoneBody: {
		minWidth: controlSize._0,
		paddingBottom: controlSize._1,
		paddingLeft: controlSize._1_5,
	},
	toolMilestoneToggle: {
		alignItems: "center",
		borderRadius: radius.sm,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		gap: controlSize._1_5,
		maxWidth: "100%",
		minHeight: controlSize._6,
		minWidth: controlSize._0,
		paddingInline: controlSize._1,
		textAlign: "left",
		width: "100%",
	},
	toolMilestoneLabel: {
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	toolMilestoneDetail: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		maxWidth: "42%",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	toolMilestoneChevron: {
		flexShrink: 0,
		marginLeft: "auto",
	},
	toolOutputWrap: {
		position: "relative",
	},
	toolOutput: {
		maxHeight: "7rem",
		overflow: "auto",
		whiteSpace: "pre-wrap",
		overflowWrap: "break-word",
		borderRadius: radius.sm,
		backgroundColor: color.backgroundRaised,
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		lineHeight: 1.6,
		marginBottom: controlSize._0,
		marginTop: "0.125rem",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	toolCopyOverlay: {
		opacity: {
			default: 0,
			":hover": 1,
		},
		position: "absolute",
		right: controlSize._1,
		top: controlSize._1,
		transitionDuration: motion.durationBase,
		transitionProperty: "opacity",
		transitionTimingFunction: motion.ease,
	},
	assistantMessage: {
		position: "relative",
		width: "100%",
		minWidth: controlSize._0,
		overflowWrap: "break-word",
		color: color.textSoft,
		fontSize: font.size_3,
		lineHeight: 1.6,
	},
	messageActionRow: {
		display: "flex",
		justifyContent: "flex-end",
		marginTop: controlSize._1,
	},
	copyMessageButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceControl,
		},
		borderRadius: radius.sm,
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		display: "inline-flex",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		minHeight: controlSize._6,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1_5,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color",
		transitionTimingFunction: motion.ease,
	},
	copyMessageButtonCopied: {
		backgroundColor: color.successWash,
		color: color.success,
	},
	messageList: {
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0,
		minHeight: "100%",
		minWidth: controlSize._0,
		paddingBottom: CHAT_LIST_BOTTOM_PADDING_PX,
		paddingInline: CHAT_LIST_INLINE_GUTTER,
		paddingTop: CHAT_LIST_TOP_PADDING_PX,
		width: "100%",
	},
	continuingToolRow: { paddingBottom: controlSize._0 },
	messageRow: {
		boxSizing: "border-box",
		flexShrink: 0,
		paddingBottom: controlSize._2,
		minWidth: controlSize._0,
		position: "relative",
		width: "100%",
	},
});

export function getCheckpointMarkerCheckpointHeaderStyle(
	borderBottom: CSSProperties["borderBottom"],
): CSSProperties {
	return { borderBottom: borderBottom } as CSSProperties;
}

export function getCheckpointMarkerSpanStyle(
	color: CSSProperties["color"],
): CSSProperties {
	return { color: color } as CSSProperties;
}

export function getChatMessageListDivStyle(
	height: CSSProperties["height"],
): CSSProperties {
	return { height: height, flexShrink: 0 } as CSSProperties;
}

export function getChatMessageListDivStyle1(
	height: CSSProperties["height"],
): CSSProperties {
	return { height: height, flexShrink: 0 } as CSSProperties;
}
