import * as stylex from "@stylexjs/stylex";
import { assignRef, setInputValue } from "../../lib/dom.tsx";
import { styles } from "./styles.ts";
export function DropdownSearch(_props: {
	searchRef: {
		current: HTMLInputElement | null;
	};
	search: string;
	setSearch: (value: string) => void;
	setOpen: (value: boolean) => void;
}) {
	return (
		<div {...stylex.attrs(styles.searchWrap)}>
			<input
				ref={(_element) => assignRef(_props.searchRef, _element)}
				type="text"
				value={_props.search}
				onInput={setInputValue.bind(null, _props.setSearch)}
				placeholder="Search..."
				{...stylex.attrs(styles.searchInput)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						_props.setOpen(false);
					}
				}}
			/>
		</div>
	);
}
