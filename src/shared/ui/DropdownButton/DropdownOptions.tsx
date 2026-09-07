import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { domStyle } from "../../lib/dom.tsx";
import {
	DropdownCustomOption,
	selectDropdownOption,
} from "./DropdownCustomOption.tsx";
import type { DropdownOption, DropdownOptionRenderer } from "./index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function DropdownOptions(_props: {
	maxHeight: number;
	filtered: readonly DropdownOption[];
	search: string;
	emptyLabel: string;
	renderOption: DropdownOptionRenderer | undefined;
	value: string | null;
	onChange: (value: string) => void;
	setOpen: (value: boolean) => void;
}) {
	return (
		<div
			{...stylex.attrs(styles.optionsBox)}
			style={domStyle(
				inlineStyles.getDropdownButtonOptionsBoxStyle(_props.maxHeight),
			)}
		>
			{_props.filtered.length === 0 ? (
				<p {...stylex.attrs(styles.empty)}>
					{_props.search ? "No matches" : _props.emptyLabel}
				</p>
			) : (
				<For each={_props.filtered} keyed={(row) => row.id}>
					{(opt) =>
						_props.renderOption ? (
							<DropdownCustomOption
								opt={opt()}
								isSelected={opt().id === _props.value}
								renderOption={_props.renderOption}
								onChange={_props.onChange}
								setOpen={_props.setOpen}
							/>
						) : (
							<button
								type="button"
								onClick={selectDropdownOption.bind(
									null,
									_props.onChange,
									_props.setOpen,
									opt().id,
								)}
								{...stylex.attrs(
									styles.option,
									opt().id === _props.value ? styles.optionSelected : null,
								)}
							>
								{opt().icon && (
									<span {...stylex.attrs(styles.optionIcon)}>{opt().icon}</span>
								)}
								<div {...stylex.attrs(styles.optionContent)}>
									<span {...stylex.attrs(styles.optionLabel)}>
										{opt().label}
									</span>
									{opt().detail && (
										<span
											{...stylex.attrs(
												styles.detailBadge,
												(opt().detail?.includes("★") ||
													opt().detail?.includes("Best")) &&
													styles.detailBadgeFeatured,
											)}
										>
											{opt().detail}
										</span>
									)}
									{opt().status && (
										<span {...stylex.attrs(styles.optionStatus)}>
											{opt().status}
										</span>
									)}
								</div>
							</button>
						)
					}
				</For>
			)}
		</div>
	);
}
