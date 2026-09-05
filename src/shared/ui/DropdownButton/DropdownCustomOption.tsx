import * as stylex from "@octanejs/stylex";
import {
	type DropdownOption,
	type DropdownOptionRenderer,
	selectDropdownOption,
} from "../../lib/data.ts";
import { styles } from "./styles.ts";

export function DropdownCustomOption({
	opt,
	isSelected,
	renderOption,
	onChange,
	setOpen,
}: {
	opt: DropdownOption;
	isSelected: boolean;
	renderOption: DropdownOptionRenderer;
	onChange: (id: string) => void;
	setOpen: (v: boolean) => void;
}) {
	const OptionContent = renderOption as (props: {
		option: DropdownOption;
		isSelected: boolean;
	}) => unknown;
	const content =
		renderOption.length >= 2 ? (
			Reflect.apply(renderOption, undefined, [opt, isSelected])
		) : (
			<OptionContent option={opt} isSelected={isSelected} />
		);
	return (
		<button
			type="button"
			onClick={selectDropdownOption.bind(null, onChange, setOpen, opt.id)}
			{...stylex.props(styles.customOption)}
		>
			{content}
		</button>
	);
}
