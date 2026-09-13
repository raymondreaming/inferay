import * as stylex from "@stylexjs/stylex";
import { assignRef, setInputValue } from "../../lib/dom.tsx";
import { TextInput } from "../TextInput/index.tsx";
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
			<TextInput
				ref={(_element: HTMLInputElement) =>
					assignRef(_props.searchRef, _element)
				}
				type="text"
				size="sm"
				fullWidth
				value={_props.search}
				onInput={setInputValue.bind(null, _props.setSearch)}
				placeholder="Search…"
				class={stylex.attrs(styles.searchInput).class}
				onKeyDown={(e: KeyboardEvent) => {
					if (e.key === "Escape") {
						_props.setOpen(false);
					}
				}}
			/>
		</div>
	);
}
