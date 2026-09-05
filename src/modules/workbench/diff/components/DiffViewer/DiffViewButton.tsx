import * as stylex from "@octanejs/stylex";
import { diffStyles } from "./styles.ts";

export function DiffViewButton({
	active,
	title,
	icon,
	onClick,
}: {
	active: boolean;
	title: string;
	icon: unknown;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={title}
			onClick={onClick}
			{...stylex.props(
				diffStyles.viewButton,
				active && diffStyles.viewButtonActive,
			)}
		>
			{icon}
		</button>
	);
}
