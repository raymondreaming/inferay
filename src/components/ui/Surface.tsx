import * as stylex from "@stylexjs/stylex";
import type { HTMLAttributes, ReactNode } from "react";
import { color, controlSize, font, radius } from "../../tokens.stylex.ts";

interface PanelProps extends HTMLAttributes<HTMLElement> {
	children: ReactNode;
	as?: "section" | "div" | "aside";
}

export function Panel({
	as = "section",
	className = "",
	children,
	...props
}: PanelProps) {
	const Component = as;
	const panelProps = stylex.props(styles.panel);
	return (
		<Component
			{...panelProps}
			className={`${panelProps.className ?? ""} ${className}`}
			{...props}
		>
			{children}
		</Component>
	);
}

interface PanelHeaderProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	"title"
> {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
}

export function PanelHeader({
	title,
	description,
	actions,
	className = "",
	...props
}: PanelHeaderProps) {
	const headerProps = stylex.props(styles.panelHeader);
	return (
		<div
			{...headerProps}
			className={`${headerProps.className ?? ""} ${className}`}
			{...props}
		>
			<div {...stylex.props(styles.headerText)}>
				<h2 {...stylex.props(styles.title)}>{title}</h2>
				{description ? (
					<p {...stylex.props(styles.description)}>{description}</p>
				) : null}
			</div>
			{actions ? <div {...stylex.props(styles.actions)}>{actions}</div> : null}
		</div>
	);
}

interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
	tone?: "warning" | "success" | "info";
	icon?: ReactNode;
	children: ReactNode;
}

export function Notice({
	tone = "info",
	icon,
	children,
	className = "",
	...props
}: NoticeProps) {
	const noticeProps = stylex.props(styles.notice, styles[tone]);
	return (
		<div
			{...noticeProps}
			className={`${noticeProps.className ?? ""} ${className}`}
			{...props}
		>
			{icon ? <span {...stylex.props(styles.noticeIcon)}>{icon}</span> : null}
			<span {...stylex.props(styles.noticeContent)}>{children}</span>
		</div>
	);
}

const styles = stylex.create({
	panel: {
		backgroundColor: color.surfaceTranslucent,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		overflow: "hidden",
	},
	panelHeader: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._3,
		justifyContent: "space-between",
		paddingBlock: controlSize._3,
		paddingInline: controlSize._4,
	},
	headerText: {
		minWidth: 0,
	},
	title: {
		color: color.textMain,
		fontSize: font.size_4,
		fontWeight: font.weight_5,
		margin: 0,
	},
	description: {
		color: color.textMuted,
		fontSize: font.size_1,
		marginBlockEnd: 0,
		marginBlockStart: controlSize._1,
	},
	actions: {
		alignItems: "center",
		display: "flex",
		flexShrink: 0,
		gap: controlSize._2,
	},
	notice: {
		alignItems: "flex-start",
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		fontSize: font.size_1,
		gap: controlSize._2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	warning: {
		backgroundColor: "rgba(245, 158, 11, 0.08)",
		borderColor: "rgba(245, 158, 11, 0.25)",
		color: "#fde68a",
	},
	success: {
		backgroundColor: "rgba(16, 185, 129, 0.1)",
		borderColor: "rgba(16, 185, 129, 0.25)",
		color: "#a7f3d0",
	},
	info: {
		backgroundColor: "rgba(100, 210, 255, 0.08)",
		borderColor: "rgba(100, 210, 255, 0.25)",
		color: "#bae6fd",
	},
	noticeIcon: {
		flexShrink: 0,
		marginTop: "0.125rem",
	},
	noticeContent: {
		minWidth: 0,
		overflowWrap: "break-word",
	},
});
