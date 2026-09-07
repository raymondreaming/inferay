import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { FileTypeIcon } from "../FileTypeIcon/index.tsx";
import type { FileSearchResult } from "./index.tsx";
import { styles } from "./styles.ts";
export function FileSearchResultRow(_props: {
	result: FileSearchResult;
	index: number;
	selectedIndex: number;
	setSelectedIndex: (index: number) => void;
	choose: (result: FileSearchResult) => void;
}) {
	return (
		<button
			type="button"
			onMouseEnter={() => _props.setSelectedIndex(_props.index)}
			onPointerDown={(event) => {
				if (event.button === 0 && event.isPrimary) _props.choose(_props.result);
			}}
			onClick={(event) => {
				if (event.detail === 0) _props.choose(_props.result);
			}}
			{...stylex.attrs(
				styles.result,
				_props.index === _props.selectedIndex && styles.resultActive,
			)}
		>
			<FileTypeIcon path={_props.result.path} size={iconSize.lg} />
			<span {...stylex.attrs(styles.resultText)}>
				<strong {...stylex.attrs(styles.resultName)}>
					{_props.result.path.split("/").pop() || _props.result.path}
				</strong>
				<small {...stylex.attrs(styles.resultPath)}>
					{(() => {
						const name =
							_props.result.path.split("/").pop() || _props.result.path;
						return _props.result.path === name
							? "Project root"
							: _props.result.path.slice(0, -(name.length + 1));
					})()}
				</small>
			</span>
		</button>
	);
}
