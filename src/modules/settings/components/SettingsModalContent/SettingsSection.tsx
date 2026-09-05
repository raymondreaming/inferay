import * as stylex from "@octanejs/stylex";
import { styles } from "./styles.ts";

export function SettingsSection({
	id,
	title,
	description,
	actions,
	children,
}: {
	id: string;
	title: string;
	description: string;
	actions?: unknown;
	children: unknown;
}) {
	return (
		<section id={id} {...stylex.props(styles.settingsSection)}>
			<div {...stylex.props(styles.sectionIntro)}>
				<div {...stylex.props(styles.sectionIntroText)}>
					<h2 {...stylex.props(styles.sectionTitle)}>{title}</h2>
					<p {...stylex.props(styles.sectionDescription)}>{description}</p>
				</div>
				{actions ? (
					<div {...stylex.props(styles.sectionActions)}>{actions}</div>
				) : null}
			</div>
			{children}
		</section>
	);
}
