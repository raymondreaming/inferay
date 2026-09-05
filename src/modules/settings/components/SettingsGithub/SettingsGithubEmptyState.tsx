import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import {
	IconAgent,
	IconGitBranch,
} from "../../../../shared/ui/Icons/index.tsx";
import { WorkspaceEmptyState } from "../../../../shared/ui/WorkspacePage/index.tsx";

export function SettingsGithubEmptyState({
	onConnect,
	connecting,
}: {
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
					onClick={onConnect}
					disabled={connecting}
					variant="secondary"
					size="sm"
				>
					<IconAgent size={iconSize.md} />
					<span>{connecting ? "Opening GitHub…" : "Run gh auth login"}</span>
				</Button>
			}
		/>
	);
}
