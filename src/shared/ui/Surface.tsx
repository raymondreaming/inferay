import * as stylex from "@octanejs/stylex";
import type { Octane } from "octane/jsx-runtime";
import { color, controlSize, font, radius } from "../../tokens.stylex.ts";

interface NoticeProps extends Octane.HTMLAttributes<HTMLDivElement> {
	tone?: "warning" | "success" | "info";
	icon?: unknown;
	children: unknown;
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
		backgroundColor: color.warningWashStrong,
		borderColor: color.warningBorderSoft,
		color: color.warningText,
	},
	success: {
		backgroundColor: color.successWash,
		borderColor: color.successBorderSoft,
		color: color.successText,
	},
	info: {
		backgroundColor: color.infoWash,
		borderColor: color.infoBorder,
		color: color.infoText,
	},
	noticeIcon: {
		flexShrink: 0,
		marginTop: "0.125rem",
	},
	noticeContent: {
		minWidth: controlSize._0,
		overflowWrap: "break-word",
	},
});
