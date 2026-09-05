import * as stylex from "@octanejs/stylex";
import type { Octane } from "octane/jsx-runtime";
import { styles } from "./styles.ts";

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
