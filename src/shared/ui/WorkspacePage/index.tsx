import * as stylex from "@octanejs/stylex";
import type { Octane } from "octane/jsx-runtime";
import { styles } from "./styles.ts";

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
