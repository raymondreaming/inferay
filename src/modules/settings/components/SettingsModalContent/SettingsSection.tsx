import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconRefreshCw } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function SettingsSection(_props: {
	id: string;
	title: string;
	description: string;
	onRefresh?: () => unknown;
	refreshLabel?: string;
	refreshNoShrink?: boolean;
	children: Element;
}) {
	return (
		<section id={_props.id} {...stylex.attrs(styles.settingsSection)}>
			<div {...stylex.attrs(styles.sectionIntro)}>
				<div {...stylex.attrs(styles.sectionIntroText)}>
					<h2 {...stylex.attrs(styles.sectionTitle)}>{_props.title}</h2>
					<p {...stylex.attrs(styles.sectionDescription)}>
						{_props.description}
					</p>
				</div>
				{_props.onRefresh ? (
					<div {...stylex.attrs(styles.sectionActions)}>
						<Button
							liquid={false}
							type="button"
							onClick={() => void _props.onRefresh?.()}
							variant="secondary"
							size="sm"
							class={
								(
									_props.refreshNoShrink === undefined
										? false
										: _props.refreshNoShrink
								)
									? stylex.attrs(styles.noShrink).class
									: undefined
							}
						>
							<IconRefreshCw size={iconSize.md} />
							<span>
								{_props.refreshLabel === undefined
									? "Refresh"
									: _props.refreshLabel}
							</span>
						</Button>
					</div>
				) : null}
			</div>
			{_props.children}
		</section>
	);
}
