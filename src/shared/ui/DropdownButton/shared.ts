export interface DropdownOption {
	id: string;
	label: string;
	detail?: string;
	status?: string;
	icon?: unknown;
}

export type DropdownOptionRenderer =
	| ((props: { option: DropdownOption; isSelected: boolean }) => unknown)
	| ((option: DropdownOption, isSelected: boolean) => unknown);

export function selectDropdownOption(
	onChange: (id: string) => void,
	setOpen: (v: boolean) => void,
	id: string,
) {
	onChange(id);
	setOpen(false);
}
