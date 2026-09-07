import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import {
	IconChevronRight,
	IconFolder,
	IconGitBranch,
} from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

export function DirectoryResult({
	pick,
	active,
	displayPath,
	onSelect,
	searchable = false,
	highlight = true,
	onHover,
}: {
	pick: { path: string; name: string; isGitRepo: boolean };
	active: boolean;
	displayPath: string;
	onSelect: (path: string) => void;
	searchable?: boolean;
	highlight?: boolean;
	onHover?: () => void;
}) {
	return (
		<button
			type="button"
			onMouseDown={searchable ? (event) => event.preventDefault() : undefined}
			onMouseMove={onHover}
			onClick={onSelect.bind(null, pick.path)}
			{...stylex.props(
				searchable ? styles.resultRowCompact : styles.resultRow,
				active &&
					highlight &&
					(searchable ? styles.resultRowActiveAccent : styles.resultRowActive),
			)}
		>
			<span {...stylex.props(styles.resultIcon, active && styles.accentText)}>
				{pick.isGitRepo ? (
					<IconGitBranch size={searchable ? iconSize.md : iconSize._2md} />
				) : (
					<IconFolder size={iconSize._2md} />
				)}
			</span>
			<div {...stylex.props(styles.resultText)}>
				<span {...stylex.props(styles.resultName)}>{pick.name}</span>
				<span
					{...stylex.props(
						searchable ? styles.resultPathSmall : styles.resultPath,
					)}
				>
					{displayPath}
				</span>
			</div>
			<IconChevronRight
				size={searchable ? iconSize.sm : iconSize.compact}
				{...stylex.props(styles.chevron)}
			/>
		</button>
	);
}
