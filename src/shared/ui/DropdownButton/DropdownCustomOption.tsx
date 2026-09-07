import { Dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import type { DropdownOption, DropdownOptionRenderer } from "./index.tsx";
import { styles } from "./styles.ts";
export function DropdownCustomOption(_props: {
	opt: DropdownOption;
	isSelected: boolean;
	renderOption: DropdownOptionRenderer;
	onChange: (id: string) => void;
	setOpen: (v: boolean) => void;
}) {
	const OptionContent = createMemo(
		() =>
			_props.renderOption as (props: {
				option: DropdownOption;
				isSelected: boolean;
			}) => import("solid-js").Element,
	);

	return (
		<button
			type="button"
			onClick={selectDropdownOption.bind(
				null,
				_props.onChange,
				_props.setOpen,
				_props.opt.id,
			)}
			{...stylex.attrs(styles.customOption)}
		>
			<Dynamic
				component={OptionContent()}
				option={_props.opt}
				isSelected={_props.isSelected}
			/>
		</button>
	);
}
export function selectDropdownOption(
	onChange: (id: string) => void,
	setOpen: (v: boolean) => void,
	id: string,
) {
	onChange(id);
	setOpen(false);
}
