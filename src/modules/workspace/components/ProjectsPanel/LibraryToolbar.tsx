import { IconSearch } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { styles } from "./styles.ts";

export function LibraryToolbar(props: {
	label: string;
	value: string;
	onInput: (value: string) => void;
	children?: Element;
}) {
	return (
		<div {...stylex.attrs(styles.libraryToolbar)}>
			<label {...stylex.attrs(styles.librarySearch)}>
				<IconSearch size={16} />
				<input
					type="search"
					aria-label={props.label}
					placeholder={props.label}
					value={props.value}
					onInput={(event) => props.onInput(event.currentTarget.value)}
					{...stylex.attrs(styles.automationSearchInput)}
				/>
			</label>
			{props.children}
		</div>
	);
}
