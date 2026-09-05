import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import {
	IconMinus,
	IconPencil,
	IconPlus,
} from "../../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

export function FileStatusIcon({ status }: { status: string }) {
	switch (status) {
		case "M":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.modified)}
					title="Modified"
				>
					<IconPencil size={iconSize.sm} />
				</span>
			);
		case "A":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.addedStatus)}
					title="Added"
				>
					<IconPlus size={iconSize.xs} />
				</span>
			);
		case "D":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.deletedStatus)}
					title="Deleted"
				>
					<IconMinus size={iconSize.xs} />
				</span>
			);
		case "R":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.renamedStatus)}
					title="Renamed"
				>
					R
				</span>
			);
		case "?":
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.addedStatus)}
					title="Untracked"
				>
					<IconPlus size={iconSize.xs} />
				</span>
			);
		default:
			return (
				<span
					{...stylex.props(styles.statusIcon, styles.defaultStatus)}
					title={status}
				>
					{status.charAt(0) || "•"}
				</span>
			);
	}
}
