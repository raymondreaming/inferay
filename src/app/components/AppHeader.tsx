import { useLocation, useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useEffect, useMemo, useState } from "octane";
import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../../adapters/storage/keys.ts";
import {
	readStoredValue,
	writeStoredValue,
} from "../../adapters/storage/stored-values.ts";
import {
	type AgentMainView,
	APP_PAGE_ROUTES,
	DEFAULT_AGENT_MAIN_VIEW,
	isAgentMainView,
	SIDEBAR_NAV_ROUTES,
} from "../../app/model/navigation.tsx";
import { iconSize } from "../../design-system.ts";
import { openSettingsModal } from "../../modules/settings/model/settings-events.ts";
import { dispatchOpenActiveGitGraph } from "../../modules/workbench/model/workbench-events.ts";
import {
	agentStateKey,
	dispatchAgentShellChange,
	loadAgentState,
} from "../../modules/workspace/model/workspace-model.ts";
import { listenWindowEvent } from "../../shared/lib/react-events.ts";
import {
	IconGitBranch,
	IconMessageCircle,
	IconPlus,
	IconSettings,
	IconWorkflow,
} from "../../shared/ui/Icons.tsx";
import { CommandPalette } from "./CommandPalette.tsx";

const AUTOMATIONS_ROUTE = APP_PAGE_ROUTES.find(
	(route) => route.id === "automations",
);

function loadShellState() {
	const agentState = loadAgentState();
	const mainView = readStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY);
	return {
		groups: agentState?.groups ?? [],
		selectedGroupId:
			agentState?.selectedGroupId ?? agentState?.groups[0]?.id ?? null,
		mainView: isAgentMainView(mainView) ? mainView : DEFAULT_AGENT_MAIN_VIEW,
		key: agentState ? agentStateKey(agentState) : "",
	};
}

/** Hosts global commands without reserving permanent application chrome. */
export function AppHeader() {
	const location = useLocation();
	const navigate = useNavigate();
	const [shellState, setShellState] = useState(loadShellState);
	const isAgentRoute = location.pathname === "/agent";

	const refreshShellState = useCallback(() => {
		const next = loadShellState();
		setShellState((current) =>
			current.key === next.key && current.mainView === next.mainView
				? current
				: next,
		);
	}, []);

	useEffect(
		() => listenWindowEvent("agent-shell-change", refreshShellState),
		[refreshShellState],
	);

	const activateMainView = useCallback(
		(view: AgentMainView) => {
			if (shellState.mainView !== view) {
				writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, view);
				setShellState((current) =>
					current.mainView === view ? current : { ...current, mainView: view },
				);
				dispatchAgentShellChange({
					source: "view",
					reason: "main-view",
					mainView: view,
				});
			}
			if (!isAgentRoute) navigate({ to: "/agent" });
		},
		[isAgentRoute, navigate, shellState.mainView],
	);

	const activateRoute = useCallback(
		(path: string) => navigate({ to: path }),
		[navigate],
	);
	const selectedGroup = shellState.groups.find(
		(group) => group.id === shellState.selectedGroupId,
	);
	const selectedCwd = selectedGroup?.panes.find(
		(pane) => pane.id === selectedGroup.selectedPaneId,
	)?.cwd;
	const openCommitGraph = useCallback(() => {
		if (!selectedCwd) return;
		activateMainView("chat");
		requestAnimationFrame(dispatchOpenActiveGitGraph);
	}, [activateMainView, selectedCwd]);
	const createNewChat = useCallback(() => {
		activateMainView("chat");
		requestAnimationFrame(() =>
			requestAnimationFrame(() =>
				window.dispatchEvent(new CustomEvent("create-agent-chat")),
			),
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
				run: () => activateMainView("chat"),
			},
			{
				id: "graph",
				label: "Open commit graph",
				detail: "Inspect the selected repository history",
				keywords: "git branches history",
				icon: <IconGitBranch size={iconSize.compact} />,
				run: openCommitGraph,
			},
			...SIDEBAR_NAV_ROUTES.map((route) => {
				const Icon = route.icon;
				return {
					id: route.id,
					label: `Open ${route.label.toLocaleLowerCase()}`,
					detail: `Go to the ${route.label} page`,
					keywords: `navigate ${route.label}`,
					icon: <Icon size={iconSize.compact} />,
					run: () => activateRoute(route.path),
				};
			}),
			...(AUTOMATIONS_ROUTE
				? [
						{
							id: AUTOMATIONS_ROUTE.id,
							label: "Open automations",
							detail: "Manage recurring agent work",
							keywords: "scheduled tasks workflows",
							icon: <IconWorkflow size={iconSize.compact} />,
							run: () => activateRoute(AUTOMATIONS_ROUTE.path),
						},
					]
				: []),
			{
				id: "settings",
				label: "Open settings",
				detail: "Configure Inferay",
				keywords: "settings preferences configuration",
				icon: <IconSettings size={iconSize.compact} />,
				run: openSettingsModal,
			},
		],
		[activateMainView, activateRoute, createNewChat, openCommitGraph],
	);

	return <CommandPalette commands={commands} showTrigger={false} />;
}
