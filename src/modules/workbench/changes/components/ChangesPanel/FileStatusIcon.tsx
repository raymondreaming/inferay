import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import {
	IconMinus,
	IconPencil,
	IconPlus,
} from "../../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function FileStatusIcon(_props: { status: string }) {
	return (
		<>
			{(() => {
				switch (_props.status) {
					case "M":
						return (
							<span
								{...stylex.attrs(styles.statusIcon, styles.modified)}
								title="Modified"
							>
								<IconPencil size={iconSize.sm} />
							</span>
						);
					case "A":
						return (
							<span
								{...stylex.attrs(styles.statusIcon, styles.addedStatus)}
								title="Added"
							>
								<IconPlus size={iconSize.xs} />
							</span>
						);
					case "D":
						return (
							<span
								{...stylex.attrs(styles.statusIcon, styles.deletedStatus)}
								title="Deleted"
							>
								<IconMinus size={iconSize.xs} />
							</span>
						);
					case "R":
						return (
							<span
								{...stylex.attrs(styles.statusIcon, styles.renamedStatus)}
								title="Renamed"
							>
								R
							</span>
						);
					case "?":
						return (
							<span
								{...stylex.attrs(styles.statusIcon, styles.addedStatus)}
								title="Untracked"
							>
								<IconPlus size={iconSize.xs} />
							</span>
						);
					default:
						return (
							<span
								{...stylex.attrs(styles.statusIcon, styles.defaultStatus)}
								title={_props.status}
							>
								{_props.status.charAt(0) || "•"}
							</span>
						);
				}
			})()}
		</>
	);
}
