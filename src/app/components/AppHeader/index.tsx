import { useLocation, useNavigate } from "@solidjs/router";
import { createMemo } from "solid-js";
import { iconSize } from "../../../design-system/styles.stylex.ts";
import { useWorkspaceState } from "../../../modules/workspace/hooks/useWorkspaceState.tsx";
import {
	dispatchCreateAgentChat,
	dispatchOpenActiveGitGraph,
	openSettingsModal,
	openSkills,
} from "../../../shared/lib/dom.tsx";
import {
	IconGitBranch,
	IconMessageCircle,
	IconPlus,
	IconSettings,
} from "../../../shared/ui/Icons/index.tsx";
import { CommandPalette } from "../CommandPalette/index.tsx";
export function AppHeader() {
	const navigate = useNavigate();
	const location = useLocation();
	const [shellState] = useWorkspaceState(() => false);
	const isAgentRoute = createMemo(() => location.pathname === "/");
	const activateMainView = () => {
		if (!isAgentRoute()) navigate("/");
	};
	const selectedGroup = createMemo(() =>
		shellState().groups.find(
			(group) => group.id === shellState().selectedGroupId,
		),
	);
	const selectedCwd = createMemo(
		() =>
			selectedGroup()?.panes.find(
				(pane) => pane.id === selectedGroup()?.selectedPaneId,
			)?.cwd,
	);
	const openCommitGraph = () => {
		if (!selectedCwd()) return;
		activateMainView();
		requestAnimationFrame(dispatchOpenActiveGitGraph);
	};
	const createNewChat = () => {
		activateMainView();
		requestAnimationFrame(() =>
			requestAnimationFrame(() => dispatchCreateAgentChat()),
		);
	};
	const commands = [
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
	];
	return <CommandPalette commands={commands} showTrigger={false} />;
}
