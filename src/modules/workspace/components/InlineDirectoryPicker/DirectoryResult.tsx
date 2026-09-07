import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import {
	IconChevronRight,
	IconFolder,
	IconGitBranch,
} from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function DirectoryResult(_props: {
	pick: {
		path: string;
		name: string;
		isGitRepo: boolean;
	};
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
			onMouseDown={
				(_props.searchable === undefined ? false : _props.searchable)
					? (event) => event.preventDefault()
					: undefined
			}
			onMouseMove={_props.onHover}
			onClick={_props.onSelect.bind(null, _props.pick.path)}
			{...stylex.attrs(
				(_props.searchable === undefined ? false : _props.searchable)
					? styles.resultRowCompact
					: styles.resultRow,
				_props.active &&
					(_props.highlight === undefined ? true : _props.highlight) &&
					((_props.searchable === undefined ? false : _props.searchable)
						? styles.resultRowActiveAccent
						: styles.resultRowActive),
			)}
		>
			<span
				{...stylex.attrs(styles.resultIcon, _props.active && styles.accentText)}
			>
				{_props.pick.isGitRepo ? (
					<IconGitBranch
						size={
							(_props.searchable === undefined ? false : _props.searchable)
								? iconSize.md
								: iconSize._2md
						}
					/>
				) : (
					<IconFolder size={iconSize._2md} />
				)}
			</span>
			<div {...stylex.attrs(styles.resultText)}>
				<span {...stylex.attrs(styles.resultName)}>{_props.pick.name}</span>
				<span
					{...stylex.attrs(
						(_props.searchable === undefined ? false : _props.searchable)
							? styles.resultPathSmall
							: styles.resultPath,
					)}
				>
					{_props.displayPath}
				</span>
			</div>
			<IconChevronRight
				size={
					(_props.searchable === undefined ? false : _props.searchable)
						? iconSize.sm
						: iconSize.compact
				}
				{...stylex.attrs(styles.chevron)}
			/>
		</button>
	);
}
