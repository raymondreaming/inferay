import type { ComponentType } from "react";
import {
	IconCode,
	IconFilePlus,
	IconGitBranch,
	IconMessageCircle,
	IconSimulator,
	IconSlash,
} from "../components/ui/Icons.tsx";
import { hasId } from "./data.ts";
import { FEATURE_FLAGS } from "./feature-flags.ts";

export type AppRouteId =
	| "agent"
	| "prompts"
	| "sessions"
	| "automations"
	| "images"
	| "simulators"
	| "profile";

export type AgentMainView = "chat" | "editor" | "graph";

type NavigationIcon = ComponentType<{ size?: number; className?: string }>;

interface AppPageRoute {
	id: AppRouteId;
	label: string;
	path: string;
	sidebar?: boolean;
	icon?: NavigationIcon;
}

interface AgentMainViewRoute {
	id: AgentMainView;
	label: string;
	icon: NavigationIcon;
}

export const DEFAULT_APP_ROUTE = "/agent";
export const DEFAULT_AGENT_MAIN_VIEW: AgentMainView = "chat";

const ALL_APP_PAGE_ROUTES = [
	{ id: "agent", label: "Agent", path: "/agent" },
	{
		id: "prompts",
		label: "Skills",
		path: "/skills",
		sidebar: true,
		icon: IconSlash,
	},
	{
		id: "sessions",
		label: "Sessions",
		path: "/sessions",
		sidebar: true,
		icon: IconMessageCircle,
	},
	{
		id: "automations",
		label: "Automations",
		path: "/automations",
	},
	{
		id: "images",
		label: "Files",
		path: "/images",
		sidebar: true,
		icon: IconFilePlus,
	},
	{
		id: "simulators",
		label: "Simulators",
		path: "/simulators",
		sidebar: true,
		icon: IconSimulator,
	},
	{ id: "profile", label: "Profile", path: "/profile" },
] as const satisfies readonly AppPageRoute[];

export const APP_PAGE_ROUTES: readonly AppPageRoute[] =
	ALL_APP_PAGE_ROUTES.filter((route) => FEATURE_FLAGS[route.id]);

export const SIDEBAR_NAV_ROUTES = APP_PAGE_ROUTES.filter(
	(
		route
	): route is AppPageRoute & {
		sidebar: true;
		icon: NavigationIcon;
	} => route.sidebar === true && !!route.icon
);

const ALL_AGENT_MAIN_VIEWS = [
	{ id: "chat", label: "Chat", icon: IconMessageCircle },
	{ id: "editor", label: "Editor", icon: IconCode },
	{ id: "graph", label: "Graph", icon: IconGitBranch },
] as const satisfies readonly AgentMainViewRoute[];

export const AGENT_MAIN_VIEWS: readonly AgentMainViewRoute[] =
	ALL_AGENT_MAIN_VIEWS.filter(
		(view) =>
			view.id === "chat" || view.id === "editor" || FEATURE_FLAGS[view.id]
	);

export function isAgentMainView(value: string | null): value is AgentMainView {
	return AGENT_MAIN_VIEWS.some(hasId.bind(null, value));
}
