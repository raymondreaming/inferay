import type { ComponentType } from "react";
import {
	IconCode,
	IconFilePlus,
	IconMessageCircle,
	IconSlash,
	IconTarget,
	IconWorkflow,
} from "../components/ui/Icons.tsx";
import { FEATURE_FLAGS, type FeatureFlagName } from "./feature-flags.ts";

export type AppRouteId =
	| "terminal"
	| "sessions"
	| "prompts"
	| "goals"
	| "automations"
	| "images"
	| "profile";

export type TerminalMainView = "chat" | "editor";

type NavigationIcon = ComponentType<{ size?: number; className?: string }>;

interface AppPageRoute {
	id: AppRouteId;
	label: string;
	path: string;
	feature?: FeatureFlagName;
	sidebar?: boolean;
	icon?: NavigationIcon;
}

interface TerminalMainViewRoute {
	id: TerminalMainView;
	label: string;
	feature: FeatureFlagName;
	icon: NavigationIcon;
}

export const DEFAULT_APP_ROUTE = "/terminal";
export const DEFAULT_TERMINAL_MAIN_VIEW: TerminalMainView = "chat";

const ALL_APP_PAGE_ROUTES: readonly AppPageRoute[] = [
	{ id: "terminal", label: "Terminal", path: "/terminal" },
	{
		id: "sessions",
		label: "Sessions",
		path: "/sessions",
		icon: IconMessageCircle,
	},
	{
		id: "prompts",
		label: "Prompts",
		path: "/prompts",
		feature: "prompts",
		sidebar: true,
		icon: IconSlash,
	},
	{
		id: "goals",
		label: "Work",
		path: "/goals",
		feature: "goals",
		sidebar: true,
		icon: IconTarget,
	},
	{
		id: "automations",
		label: "Automations",
		path: "/automations",
		feature: "automations",
		sidebar: true,
		icon: IconWorkflow,
	},
	{
		id: "images",
		label: "Artifacts",
		path: "/images",
		feature: "images",
		sidebar: true,
		icon: IconFilePlus,
	},
	{ id: "profile", label: "Profile", path: "/profile" },
] as const;

export const APP_PAGE_ROUTES = ALL_APP_PAGE_ROUTES.filter(
	(route) => route.feature === undefined || FEATURE_FLAGS[route.feature]
);

export const SIDEBAR_NAV_ROUTES = APP_PAGE_ROUTES.filter(
	(
		route
	): route is AppPageRoute & {
		sidebar: true;
		icon: NavigationIcon;
	} => route.sidebar === true && !!route.icon
);

const ALL_TERMINAL_MAIN_VIEWS: readonly TerminalMainViewRoute[] = [
	{ id: "chat", label: "Chat", feature: "chat", icon: IconMessageCircle },
	{ id: "editor", label: "Editor", feature: "editor", icon: IconCode },
];

export const TERMINAL_MAIN_VIEWS = ALL_TERMINAL_MAIN_VIEWS.filter(
	(view) => FEATURE_FLAGS[view.feature]
);

export function isTerminalMainView(
	value: string | null
): value is TerminalMainView {
	return TERMINAL_MAIN_VIEWS.some((view) => view.id === value);
}
