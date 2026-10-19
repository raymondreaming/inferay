import { iconSize } from "@design-system/styles.stylex.ts";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconAgent, IconGitBranch } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";
export function SettingsGithubEmptyState(_props: {
	onConnect: () => void;
	connecting: boolean;
}) {
	return (
		<div {...stylex.attrs(styles.emptyState)}>
			<span {...stylex.attrs(styles.emptyIcon)}>
				<IconGitBranch size={iconSize.xl} />
			</span>
			<div {...stylex.attrs(styles.emptyText)}>
				<span {...stylex.attrs(styles.emptyTitle)}>
					No GitHub accounts found
				</span>
				<span {...stylex.attrs(styles.emptyDescription)}>
					Connect with the GitHub CLI and Inferay will pick up the account
					automatically.
				</span>
			</div>
			<div {...stylex.attrs(styles.emptyAction)}>
				<Button
					type="button"
					onClick={_props.onConnect}
					disabled={_props.connecting}
					variant="secondary"
					size="sm"
				>
					<IconAgent size={iconSize.md} />
					<span>
						{_props.connecting ? "Opening GitHub…" : "Run gh auth login"}
					</span>
				</Button>
			</div>
		</div>
	);
}
