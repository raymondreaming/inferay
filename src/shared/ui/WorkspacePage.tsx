import * as stylex from "@octanejs/stylex";
import type { Octane } from "octane/jsx-runtime";
import { color, controlSize, font, radius } from "../../tokens.stylex.ts";

interface WorkspaceEmptyStateProps
	extends Omit<Octane.HTMLAttributes<HTMLDivElement>, "title"> {
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
