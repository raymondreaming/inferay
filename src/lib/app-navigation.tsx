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
	| "terminal"
	| "prompts"
	| "sessions"
	| "automations"
	| "images"
	| "simulators"
	| "profile";

export type TerminalMainView = "chat" | "editor" | "graph";

type NavigationIcon = ComponentType<{ size?: number; className?: string }>;

interface AppPageRoute {
	id: AppRouteId;
	label: string;
	path: string;
	sidebar?: boolean;
	icon?: NavigationIcon;
}

interface TerminalMainViewRoute {
	id: TerminalMainView;
	label: string;
	icon: NavigationIcon;
}

export const DEFAULT_APP_ROUTE = "/terminal";
export const DEFAULT_TERMINAL_MAIN_VIEW: TerminalMainView = "chat";

const ALL_APP_PAGE_ROUTES = [
	{ id: "terminal", label: "Terminal", path: "/terminal" },
	{
		id: "prompts",
		label: "Prompts",
		path: "/prompts",
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

const ALL_TERMINAL_MAIN_VIEWS = [
	{ id: "chat", label: "Chat", icon: IconMessageCircle },
	{ id: "editor", label: "Editor", icon: IconCode },
	{ id: "graph", label: "Graph", icon: IconGitBranch },
] as const satisfies readonly TerminalMainViewRoute[];

export const TERMINAL_MAIN_VIEWS: readonly TerminalMainViewRoute[] =
	ALL_TERMINAL_MAIN_VIEWS.filter((view) => FEATURE_FLAGS[view.id]);

export function isTerminalMainView(
	value: string | null
): value is TerminalMainView {
	return TERMINAL_MAIN_VIEWS.some(hasId.bind(null, value));
}
