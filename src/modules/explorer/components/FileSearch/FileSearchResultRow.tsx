import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { FileTypeIcon } from "../FileTypeIcon/index.tsx";
import type { FileSearchResult } from "./index.tsx";
import { styles } from "./styles.ts";

export function FileSearchResultRow({
	result,
	index,
	selectedIndex,
	setSelectedIndex,
	choose,
}: {
	result: FileSearchResult;
	index: number;
	selectedIndex: number;
	setSelectedIndex: (index: number) => void;
	choose: (result: FileSearchResult) => void;
}) {
	return (
		<button
			key={result.path}
			type="button"
			onMouseEnter={() => setSelectedIndex(index)}
			onPointerDown={(event) => {
				if (event.button === 0 && event.isPrimary) choose(result);
			}}
			onClick={(event) => {
				if (event.detail === 0) choose(result);
			}}
			{...stylex.props(
				styles.result,
				index === selectedIndex && styles.resultActive,
			)}
		>
			<FileTypeIcon path={result.path} size={iconSize.lg} />
			<span {...stylex.props(styles.resultText)}>
				<strong {...stylex.props(styles.resultName)}>
					{result.path.split("/").pop() || result.path}
				</strong>
				<small {...stylex.props(styles.resultPath)}>
					{(() => {
						const name = result.path.split("/").pop() || result.path;
						return result.path === name
							? "Project root"
							: result.path.slice(0, -(name.length + 1));
					})()}
				</small>
			</span>
		</button>
	);
}
