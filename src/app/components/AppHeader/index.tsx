import { useLocation, useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useMemo } from "octane";
import { iconSize } from "../../../design-system/styles.stylex.ts";
import {
	openSettingsModal,
	openSkills,
} from "../../../modules/skills/model/skill-library.ts";
import { dispatchOpenActiveGitGraph } from "../../../modules/workbench/model/workbench-model.ts";
import {
	dispatchCreateAgentChat,
	useWorkspaceState,
} from "../../../modules/workspace/model/workspace-model.ts";
import {
	IconGitBranch,
	IconMessageCircle,
	IconPlus,
	IconSettings,
} from "../../../shared/ui/Icons/index.tsx";
import { CommandPalette } from "../CommandPalette/index.tsx";

export function AppHeader() {
	const location = useLocation();
	const navigate = useNavigate();
	const [shellState] = useWorkspaceState(false);
	const isAgentRoute = location.pathname === "/";

	const activateMainView = useCallback(() => {
		if (!isAgentRoute) navigate({ to: "/" });
	}, [isAgentRoute, navigate]);

	const selectedGroup = shellState.groups.find(
		(group) => group.id === shellState.selectedGroupId,
	);
	const selectedCwd = selectedGroup?.panes.find(
		(pane) => pane.id === selectedGroup.selectedPaneId,
	)?.cwd;
	const openCommitGraph = useCallback(() => {
		if (!selectedCwd) return;
		activateMainView();
		requestAnimationFrame(dispatchOpenActiveGitGraph);
	}, [activateMainView, selectedCwd]);
	const createNewChat = useCallback(() => {
		activateMainView();
		requestAnimationFrame(() =>
			requestAnimationFrame(() => dispatchCreateAgentChat()),
		);
	}, [activateMainView]);

	const commands = useMemo(
		() => [
			{
				id: "new-chat",
				label: "New chat",
				detail: "Start a new agent conversation",
				keywords: "create agent thread",
				icon: <IconPlus size={iconSize.compact} />,
				run: createNewChat,
			},
			{
				id: "chat",
				label: "Open chats",
				detail: "Return to your agent conversations",
				keywords: "conversation chats",
				icon: <IconMessageCircle size={iconSize.compact} />,
				run: () => activateMainView(),
			},
			{
				id: "graph",
				label: "Open commit graph",
				detail: "Inspect the selected repository history",
				keywords: "git branches history",
				icon: <IconGitBranch size={iconSize.compact} />,
				run: openCommitGraph,
			},

			{
				id: "settings",
				label: "Open settings",
				detail: "Configure Inferay",
				keywords: "settings preferences configuration",
				icon: <IconSettings size={iconSize.compact} />,
				run: () => openSettingsModal(),
			},
			{
				id: "skills",
				icon: <IconSettings size={iconSize.compact} />,
				label: "Open skills",
				detail: "Create and edit reusable instructions",
				keywords: "skills slash commands prompts",
				run: () => openSkills(),
			},
		],
		[activateMainView, createNewChat, openCommitGraph],
	);

	return <CommandPalette commands={commands} showTrigger={false} />;
}
