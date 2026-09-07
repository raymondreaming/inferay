import * as stylex from "@octanejs/stylex";
import { setInputValue } from "../../lib/data.ts";
import { styles } from "./styles.ts";

export function DropdownSearch({
	searchRef,
	search,
	setSearch,
	setOpen,
}: {
	searchRef: { current: HTMLInputElement | null };
	search: string;
	setSearch: (value: string) => void;
	setOpen: (value: boolean) => void;
}) {
	return (
		<div {...stylex.props(styles.searchWrap)}>
			<input
				ref={searchRef}
				type="text"
				value={search}
				onInput={setInputValue.bind(null, setSearch)}
				placeholder="Search..."
				{...stylex.props(styles.searchInput)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						setOpen(false);
					}
				}}
			/>
		</div>
	);
}
