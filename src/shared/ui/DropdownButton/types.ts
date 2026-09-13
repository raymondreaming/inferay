import type { Element } from "solid-js";

export interface DropdownOption {
	iconComponent?: import("solid-js").Component;
	id: string;
	label: string;
	detail?: string;
	status?: string;
	icon?: Element;
}

export type DropdownOptionRenderer = (props: {
	option: DropdownOption;
	isSelected: boolean;
}) => Element;
