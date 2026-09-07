import * as stylex from "@stylexjs/stylex";
import type { AppThemeId } from "../../../../../build/presentation/contracts/AppThemeId.ts";
import { domStyle } from "../../../../shared/lib/dom.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function ThemeOrb(_props: {
	theme: {
		id: AppThemeId;
		name: string;
	};
	selected: boolean;
	onClick: () => void;
	dashed?: boolean;
}) {
	const black = "var(--color-inferay-black)";
	const darkGray = "var(--color-inferay-dark-gray)";
	const accent = "var(--color-inferay-accent)";
	return (
		<button
			type="button"
			onClick={_props.onClick}
			{...stylex.attrs(
				styles.themeOrbButton,
				_props.selected && styles.themeOrbSelected,
			)}
		>
			<div
				data-inferay-theme={_props.theme.id}
				{...stylex.attrs(
					styles.themeOrb,
					_props.dashed && styles.themeOrbDashed,
					_props.selected && styles.themeOrbSelectedRing,
				)}
				style={domStyle(inlineStyles.getThemeOrbThemeOrbStyle(black))}
			>
				<div
					{...stylex.attrs(styles.themeOrbFill)}
					style={domStyle(
						inlineStyles.getThemeOrbThemeOrbFillStyle(
							`radial-gradient(circle at 35% 35%, ${darkGray} 0%, ${black} 60%, ${black} 100%)`,
						),
					)}
				/>
				<div
					{...stylex.attrs(styles.themeOrbGlow)}
					style={domStyle(
						inlineStyles.getThemeOrbThemeOrbGlowStyle(
							`radial-gradient(ellipse at center, color-mix(in srgb, ${accent} 33%, transparent), transparent 70%)`,
						),
					)}
				/>
				<div
					{...stylex.attrs(styles.themeOrbHighlight)}
					style={domStyle(inlineStyles.getThemeOrbThemeOrbHighlightStyle())}
				/>
			</div>
			<span
				{...stylex.attrs(
					styles.themeOrbLabel,
					_props.selected && styles.themeOrbLabelSelected,
				)}
			>
				{_props.theme.name}
			</span>
		</button>
	);
}
