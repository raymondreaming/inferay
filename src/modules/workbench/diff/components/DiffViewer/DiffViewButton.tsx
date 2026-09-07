import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { diffStyles } from "./styles.ts";
export function DiffViewButton(_props: {
	active: boolean;
	title: string;
	icon: Element;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={_props.title}
			onClick={_props.onClick}
			{...stylex.attrs(
				diffStyles.viewButton,
				_props.active && diffStyles.viewButtonActive,
			)}
		>
			{_props.icon}
		</button>
	);
}
