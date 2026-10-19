import { iconSize } from "@design-system/styles.stylex.ts";
import {
	dispatchCreateAgentChat,
	dispatchOpenActiveGitGraph,
	openOnboarding,
	openSettingsModal,
	openSkills,
} from "@shared/lib/dom.tsx";
import {
	IconGitBranch,
	IconMessageCircle,
	IconPlus,
	IconSettings,
	IconSparkles,
} from "@shared/ui/Icons/index.tsx";
import { showProjectView } from "@workspace/hooks/useProjects.tsx";
import { useWorkspaceState } from "@workspace/hooks/useWorkspaceState.tsx";
import { createMemo } from "solid-js";
import { CommandPalette } from "../CommandPalette/index.tsx";
export function AppHeader() {
	const [shellState] = useWorkspaceState(() => false);
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
		requestAnimationFrame(dispatchOpenActiveGitGraph);
	};
	const createNewChat = () => {
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
			run: () => showProjectView("chat"),
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
			id: "onboarding",
			label: "Replay the tour",
			detail: "Walk through Inferay from the beginning",
			keywords: "onboarding tour walkthrough guide help",
			icon: <IconSparkles size={iconSize.compact} />,
			run: () => openOnboarding(),
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
	return <CommandPalette commands={commands} />;
}
