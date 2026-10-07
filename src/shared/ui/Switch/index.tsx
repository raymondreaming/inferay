import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";

export function Switch(props: {
	label: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-label={props.label}
			aria-checked={props.checked ? "true" : "false"}
			disabled={props.disabled}
			onClick={() => props.onChange(!props.checked)}
			{...stylex.attrs(styles.track, props.checked && styles.active)}
		>
			<span {...stylex.attrs(styles.thumb, props.checked && styles.checked)} />
		</button>
	);
}
