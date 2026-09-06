import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconRefreshCw } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

export function SettingsSection({
	id,
	title,
	description,
	onRefresh,
	refreshLabel = "Refresh",
	refreshNoShrink = false,
	children,
}: {
	id: string;
	title: string;
	description: string;
	onRefresh?: () => unknown;
	refreshLabel?: string;
	refreshNoShrink?: boolean;
	children: unknown;
}) {
	return (
		<section id={id} {...stylex.props(styles.settingsSection)}>
			<div {...stylex.props(styles.sectionIntro)}>
				<div {...stylex.props(styles.sectionIntroText)}>
					<h2 {...stylex.props(styles.sectionTitle)}>{title}</h2>
					<p {...stylex.props(styles.sectionDescription)}>{description}</p>
				</div>
				{onRefresh ? (
					<div {...stylex.props(styles.sectionActions)}>
						<Button
							liquid={false}
							type="button"
							onClick={() => void onRefresh()}
							variant="secondary"
							size="sm"
							className={
								refreshNoShrink
									? stylex.props(styles.noShrink).className
									: undefined
							}
						>
							<IconRefreshCw size={iconSize.md} />
							<span>{refreshLabel}</span>
						</Button>
					</div>
				) : null}
			</div>
			{children}
		</section>
	);
}
