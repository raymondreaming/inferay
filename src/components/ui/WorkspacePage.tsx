import * as stylex from "@stylexjs/stylex";
import type {
	ButtonHTMLAttributes,
	HTMLAttributes,
	InputHTMLAttributes,
	ReactNode,
} from "react";
import {
	color,
	controlSize,
	effect,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import { IconSearch } from "./Icons.tsx";

interface WorkspacePageProps extends HTMLAttributes<HTMLDivElement> {
	children: ReactNode;
}

export function WorkspacePage({
	children,
	className = "",
	...props
}: WorkspacePageProps) {
	const pageProps = stylex.props(styles.page);
	return (
		<div
			{...pageProps}
			className={`${pageProps.className ?? ""} ${className}`}
			{...props}
		>
			{children}
		</div>
	);
}

interface WorkspaceToolbarProps extends HTMLAttributes<HTMLElement> {
	children: ReactNode;
}

export function WorkspaceToolbar({
	children,
	className = "",
	...props
}: WorkspaceToolbarProps) {
	const toolbarProps = stylex.props(styles.toolbar);
	return (
		<header
			{...toolbarProps}
			className={`${toolbarProps.className ?? ""} ${className}`}
			{...props}
		>
			{children}
		</header>
	);
}

export function WorkspaceTitle({
	title,
	meta,
	kicker,
}: {
	title: ReactNode;
	meta?: ReactNode;
	kicker?: ReactNode;
}) {
	return (
		<div {...stylex.props(styles.titleBlock)}>
			{kicker ? <span {...stylex.props(styles.kicker)}>{kicker}</span> : null}
			<div {...stylex.props(styles.titleRow)}>
				<h1 {...stylex.props(styles.title)}>{title}</h1>
				{meta ? <span {...stylex.props(styles.meta)}>{meta}</span> : null}
			</div>
		</div>
	);
}

export function WorkspaceToolbarSpacer() {
	return <span {...stylex.props(styles.spacer)} />;
}

interface WorkspaceContentProps extends HTMLAttributes<HTMLElement> {
	children: ReactNode;
	padding?: "none" | "sm" | "md";
	scroll?: boolean;
}

export function WorkspaceContent({
	children,
	className = "",
	padding = "md",
	scroll = false,
	...props
}: WorkspaceContentProps) {
	const paddingStyle =
		padding === "none"
			? styles.nonePad
			: padding === "sm"
				? styles.smPad
				: styles.mdPad;
	const contentProps = stylex.props(
		styles.content,
		scroll && styles.contentScroll,
		paddingStyle
	);
	return (
		<main
			{...contentProps}
			className={`${contentProps.className ?? ""} ${className}`}
			{...props}
		>
			{children}
		</main>
	);
}

interface WorkspaceSearchProps extends Omit<
	InputHTMLAttributes<HTMLInputElement>,
	"type"
> {
	width?: "sm" | "md" | "lg";
}

export function WorkspaceSearch({
	width = "md",
	className = "",
	...props
}: WorkspaceSearchProps) {
	const wrapProps = stylex.props(styles.searchWrap, styles[width]);
	return (
		<label
			{...wrapProps}
			className={`${wrapProps.className ?? ""} ${className}`}
		>
			<IconSearch size={12} {...stylex.props(styles.searchIcon)} />
			<input type="search" {...props} {...stylex.props(styles.searchInput)} />
		</label>
	);
}

interface WorkspaceButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "primary" | "secondary" | "ghost";
}

export function WorkspaceButton({
	variant = "secondary",
	children,
	className = "",
	...props
}: WorkspaceButtonProps) {
	const buttonProps = stylex.props(styles.button, styles[variant]);
	return (
		<button
			{...buttonProps}
			className={`${buttonProps.className ?? ""} ${className}`}
			{...props}
		>
			{children}
		</button>
	);
}

interface WorkspaceIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
}

export function WorkspaceIconButton({
	children,
	className = "",
	...props
}: WorkspaceIconButtonProps) {
	const buttonProps = stylex.props(styles.iconButton);
	return (
		<button
			{...buttonProps}
			className={`${buttonProps.className ?? ""} ${className}`}
			{...props}
		>
			{children}
		</button>
	);
}

interface WorkspaceEmptyStateProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	"title"
> {
	icon?: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
}

export function WorkspaceEmptyState({
	icon,
	title,
	description,
	action,
	className = "",
	...props
}: WorkspaceEmptyStateProps) {
	const emptyProps = stylex.props(styles.emptyState);
	return (
		<div
			{...emptyProps}
			className={`${emptyProps.className ?? ""} ${className}`}
			{...props}
		>
			{icon ? <span {...stylex.props(styles.emptyIcon)}>{icon}</span> : null}
			<div {...stylex.props(styles.emptyText)}>
				<span {...stylex.props(styles.emptyTitle)}>{title}</span>
				{description ? (
					<span {...stylex.props(styles.emptyDescription)}>{description}</span>
				) : null}
			</div>
			{action ? (
				<div {...stylex.props(styles.emptyAction)}>{action}</div>
			) : null}
		</div>
	);
}

interface WorkspaceSegmentedControlProps extends HTMLAttributes<HTMLDivElement> {
	children: ReactNode;
}

export function WorkspaceSegmentedControl({
	children,
	className = "",
	...props
}: WorkspaceSegmentedControlProps) {
	const controlProps = stylex.props(styles.segmentedControl);
	return (
		<div
			{...controlProps}
			className={`${controlProps.className ?? ""} ${className}`}
			{...props}
		>
			{children}
		</div>
	);
}

interface WorkspaceSegmentButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	active?: boolean;
}

export function WorkspaceSegmentButton({
	active,
	children,
	className = "",
	...props
}: WorkspaceSegmentButtonProps) {
	const buttonProps = stylex.props(
		styles.segmentButton,
		active && styles.segmentButtonActive
	);
	return (
		<button
			{...buttonProps}
			className={`${buttonProps.className ?? ""} ${className}`}
			{...props}
		>
			{children}
		</button>
	);
}

const styles = stylex.create({
	page: {
		backgroundColor: color.background,
		color: color.textMain,
		display: "flex",
		flexDirection: "column",
		height: "100%",
		minHeight: 0,
		minWidth: 0,
		overflow: "hidden",
	},
	toolbar: {
		alignItems: "center",
		backgroundColor: color.background,
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		flexShrink: 0,
		gap: controlSize._2,
		height: controlSize._10,
		paddingInline: controlSize._3,
	},
	titleBlock: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		minWidth: 0,
	},
	kicker: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_0_5,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		letterSpacing: 0,
		textTransform: "uppercase",
	},
	titleRow: {
		alignItems: "baseline",
		display: "flex",
		gap: controlSize._2,
		minWidth: 0,
	},
	title: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		lineHeight: 1.2,
		margin: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	meta: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		whiteSpace: "nowrap",
	},
	spacer: {
		flex: 1,
	},
	content: {
		flex: 1,
		minHeight: 0,
		minWidth: 0,
		overflow: "hidden",
	},
	contentScroll: {
		overflowY: "auto",
	},
	nonePad: {
		padding: 0,
	},
	smPad: {
		padding: controlSize._2,
	},
	mdPad: {
		padding: controlSize._3,
	},
	searchWrap: {
		display: "flex",
		flexShrink: 0,
		maxWidth: "min(100%, 24rem)",
		position: "relative",
	},
	sm: {
		width: "14rem",
	},
	md: {
		width: "18rem",
	},
	lg: {
		width: "24rem",
	},
	searchIcon: {
		color: color.textMuted,
		left: controlSize._2_5,
		pointerEvents: "none",
		position: "absolute",
		top: "50%",
		transform: "translateY(-50%)",
	},
	searchInput: {
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMain,
		fontSize: font.size_2,
		height: controlSize._7,
		outline: "none",
		paddingInlineEnd: controlSize._3,
		paddingInlineStart: controlSize._8,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, box-shadow",
		width: "100%",
		":focus": {
			borderColor: color.borderStrong,
			boxShadow: shadow.controlDepthHover,
		},
		"::placeholder": {
			color: color.textMuted,
		},
	},
	button: {
		alignItems: "center",
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.controlDepth,
		display: "inline-flex",
		flexShrink: 0,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		height: controlSize._7,
		justifyContent: "center",
		paddingInline: controlSize._3,
		transitionDuration: motion.durationBase,
		transitionProperty:
			"background-color, border-color, box-shadow, color, opacity",
		":disabled": {
			opacity: 0.45,
		},
	},
	primary: {
		backgroundColor: {
			default: color.surfaceControl,
			":hover": color.surfaceControlHover,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		borderColor: color.borderStrong,
		color: color.textMain,
	},
	secondary: {
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		borderColor: color.border,
		color: color.textSoft,
	},
	ghost: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceSubtle,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
		borderColor: color.transparent,
		color: color.textMuted,
	},
	iconButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.controlDepth,
		color: color.textMuted,
		display: "inline-flex",
		flexShrink: 0,
		height: controlSize._7,
		justifyContent: "center",
		transitionDuration: motion.durationBase,
		transitionProperty:
			"background-color, border-color, box-shadow, color, opacity",
		width: controlSize._7,
		":disabled": {
			opacity: 0.45,
		},
	},
	emptyState: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		height: "100%",
		justifyContent: "center",
		minHeight: controlSize._16,
		padding: controlSize._4,
		textAlign: "center",
	},
	emptyIcon: {
		alignItems: "center",
		backgroundColor: color.background,
		borderColor: color.border,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "inline-flex",
		height: controlSize._9,
		justifyContent: "center",
		width: controlSize._9,
	},
	emptyText: {
		alignItems: "center",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		maxWidth: "28rem",
	},
	emptyTitle: {
		color: color.textSoft,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
	},
	emptyDescription: {
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
	},
	emptyAction: {
		display: "flex",
		justifyContent: "center",
		marginTop: controlSize._1,
	},
	segmentedControl: {
		alignItems: "center",
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.controlDepth,
		display: "inline-flex",
		flexShrink: 0,
		gap: controlSize._0_5,
		padding: controlSize._0_5,
	},
	segmentButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
		borderRadius: radius.xs,
		borderWidth: 0,
		color: color.textMuted,
		display: "inline-flex",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		height: controlSize._6,
		justifyContent: "center",
		paddingInline: controlSize._2,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color, opacity, box-shadow",
		whiteSpace: "nowrap",
		":disabled": {
			opacity: 0.45,
		},
	},
	segmentButtonActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		color: color.textMain,
	},
});
