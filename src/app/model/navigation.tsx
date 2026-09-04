import type { ComponentType } from "react";
import { FEATURE_FLAGS } from "../../shared/lib/feature-flags.ts";
import { IconFilePlus, IconSlash } from "../../shared/ui/Icons.tsx";

export type AppRouteId = "agent" | "prompts" | "automations" | "images";

export type AgentMainView = "chat" | "graph";

type NavigationIcon = ComponentType<{ size?: number; className?: string }>;

interface AppPageRoute {
	id: AppRouteId;
	label: string;
	path: string;
	sidebar?: boolean;
	icon?: NavigationIcon;
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
] as const satisfies readonly AppPageRoute[];

export const APP_PAGE_ROUTES: readonly AppPageRoute[] =
	ALL_APP_PAGE_ROUTES.filter((route) => FEATURE_FLAGS[route.id]);

export const SIDEBAR_NAV_ROUTES = APP_PAGE_ROUTES.filter(
	(
		route,
	): route is AppPageRoute & {
		sidebar: true;
		icon: NavigationIcon;
	} => route.sidebar === true && !!route.icon,
);

export function isAgentMainView(value: string | null): value is AgentMainView {
	return value === "chat";
}
