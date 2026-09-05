import * as stylex from "@octanejs/stylex";
import type { AppThemeId } from "../../../../app/model/appearance.ts";
import * as inlineStyles from "./styles.ts";

import { styles } from "./styles.ts";

export function ThemeOrb({
	theme,
	selected,
	onClick,
	dashed,
}: {
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
			onClick={onClick}
			{...stylex.props(
				styles.themeOrbButton,
				selected && styles.themeOrbSelected,
			)}
		>
			<div
				data-inferay-theme={theme.id}
				{...stylex.props(
					styles.themeOrb,
					dashed && styles.themeOrbDashed,
					selected && styles.themeOrbSelectedRing,
				)}
				style={inlineStyles.getThemeOrbThemeOrbStyle(black)}
			>
				<div
					{...stylex.props(styles.themeOrbFill)}
					style={inlineStyles.getThemeOrbThemeOrbFillStyle(
						`radial-gradient(circle at 35% 35%, ${darkGray} 0%, ${black} 60%, ${black} 100%)`,
					)}
				/>
				<div
					{...stylex.props(styles.themeOrbGlow)}
					style={inlineStyles.getThemeOrbThemeOrbGlowStyle(
						`radial-gradient(ellipse at center, color-mix(in srgb, ${accent} 33%, transparent), transparent 70%)`,
					)}
				/>
				<div
					{...stylex.props(styles.themeOrbHighlight)}
					style={inlineStyles.getThemeOrbThemeOrbHighlightStyle()}
				/>
			</div>
			<span
				{...stylex.props(
					styles.themeOrbLabel,
					selected && styles.themeOrbLabelSelected,
				)}
			>
				{theme.name}
			</span>
		</button>
	);
}
