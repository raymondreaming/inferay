import * as stylex from "@octanejs/stylex";
import type { Octane } from "octane/jsx-runtime";
import { color, controlSize, font, radius } from "../../tokens.stylex.ts";

interface WorkspacePageProps extends Octane.HTMLAttributes<HTMLDivElement> {
	children: unknown;
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

interface WorkspaceContentProps extends Octane.HTMLAttributes<HTMLElement> {
	children: unknown;
	padding?: "none" | "sm" | "md";
	scroll?: boolean;
	scrollRef?: { current: HTMLElement | null };
}

export function WorkspaceContent({
	children,
	className = "",
	padding = "md",
	scroll = false,
	scrollRef,
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
			ref={scrollRef}
			{...contentProps}
			className={`${contentProps.className ?? ""} ${className}`}
			{...props}
		>
			{children}
		</main>
	);
}

interface WorkspaceEmptyStateProps extends Omit<
	Octane.HTMLAttributes<HTMLDivElement>,
	"title"
> {
	icon?: unknown;
	title: unknown;
	description?: unknown;
	action?: unknown;
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

const styles = stylex.create({
	page: {
		backgroundColor: color.transparent,
		color: color.textMain,
		display: "flex",
		flexDirection: "column",
		height: "100%",
		minHeight: 0,
		minWidth: 0,
		overflow: "hidden",
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
});
