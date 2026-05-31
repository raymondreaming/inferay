import type { ComponentType } from "react";
import {
	IconCode,
	IconFilePlus,
	IconMessageCircle,
	IconSlash,
	IconTarget,
	IconWorkflow,
} from "../components/ui/Icons.tsx";

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

export const APP_PAGE_ROUTES: readonly AppPageRoute[] = [
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
		sidebar: true,
		icon: IconSlash,
	},
	{
		id: "goals",
		label: "Work",
		path: "/goals",
		sidebar: true,
		icon: IconTarget,
	},
	{
		id: "automations",
		label: "Automations",
		path: "/automations",
		sidebar: true,
		icon: IconWorkflow,
	},
	{
		id: "images",
		label: "Artifacts",
		path: "/images",
		sidebar: true,
		icon: IconFilePlus,
	},
	{ id: "profile", label: "Profile", path: "/profile" },
] as const;

export const SIDEBAR_NAV_ROUTES = APP_PAGE_ROUTES.filter(
	(
		route
	): route is AppPageRoute & {
		sidebar: true;
		icon: NavigationIcon;
	} => route.sidebar === true && !!route.icon
);

export const TERMINAL_MAIN_VIEWS: readonly TerminalMainViewRoute[] = [
	{ id: "chat", label: "Chat", icon: IconMessageCircle },
	{ id: "editor", label: "Editor", icon: IconCode },
] as const;

export function isTerminalMainView(
	value: string | null
): value is TerminalMainView {
	return value === "chat" || value === "editor";
}
