import * as stylex from "@octanejs/stylex";
import {
	DropdownCustomOption,
	selectDropdownOption,
} from "./DropdownCustomOption.tsx";
import type { DropdownOption, DropdownOptionRenderer } from "./index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function DropdownOptions({
	maxHeight,
	filtered,
	search,
	emptyLabel,
	renderOption,
	value,
	onChange,
	setOpen,
}: {
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
			{...stylex.props(styles.optionsBox)}
			style={inlineStyles.getDropdownButtonOptionsBoxStyle(maxHeight)}
		>
			{filtered.length === 0 ? (
				<p {...stylex.props(styles.empty)}>
					{search ? "No matches" : emptyLabel}
				</p>
			) : (
				filtered.map((opt) =>
					renderOption ? (
						<DropdownCustomOption
							key={opt.id}
							opt={opt}
							isSelected={opt.id === value}
							renderOption={renderOption}
							onChange={onChange}
							setOpen={setOpen}
						/>
					) : (
						<button
							type="button"
							key={opt.id}
							onClick={selectDropdownOption.bind(
								null,
								onChange,
								setOpen,
								opt.id,
							)}
							{...stylex.props(
								styles.option,
								opt.id === value ? styles.optionSelected : null,
							)}
						>
							{opt.icon && (
								<span {...stylex.props(styles.optionIcon)}>{opt.icon}</span>
							)}
							<div {...stylex.props(styles.optionContent)}>
								<span {...stylex.props(styles.optionLabel)}>{opt.label}</span>
								{opt.detail && (
									<span
										{...stylex.props(
											styles.detailBadge,
											(opt.detail.includes("★") ||
												opt.detail.includes("Best")) &&
												styles.detailBadgeFeatured,
										)}
									>
										{opt.detail}
									</span>
								)}
								{opt.status && (
									<span {...stylex.props(styles.optionStatus)}>
										{opt.status}
									</span>
								)}
							</div>
						</button>
					),
				)
			)}
		</div>
	);
}
