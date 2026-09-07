import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import {
	IconAgent,
	IconGitBranch,
} from "../../../../shared/ui/Icons/index.tsx";
import { WorkspaceEmptyState } from "../../../../shared/ui/WorkspacePage/index.tsx";
export function SettingsGithubEmptyState(_props: {
	onConnect: () => void;
	connecting: boolean;
}) {
	return (
		<WorkspaceEmptyState
			icon={<IconGitBranch size={iconSize.xl} />}
			title="No GitHub accounts found"
			description="Connect with the GitHub CLI and Inferay will pick up the account automatically."
			action={
				<Button
					liquid={false}
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
			}
		/>
	);
}
