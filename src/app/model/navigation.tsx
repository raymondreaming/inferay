import type { ComponentType } from "react";
import { IconFilePlus } from "../../shared/ui/Icons/index.tsx";

export type AppRouteId = "agent" | "images";

type NavigationIcon = ComponentType<{ size?: number; className?: string }>;

interface AppPageRoute {
	id: AppRouteId;
	label: string;
	path: string;
	sidebar?: boolean;
	icon?: NavigationIcon;
}

export const DEFAULT_APP_ROUTE = "/agent";

export const APP_PAGE_ROUTES: readonly AppPageRoute[] = [
	{ id: "agent", label: "Agent", path: "/agent" },
	{
		id: "images",
		label: "Files",
		path: "/images",
		sidebar: true,
		icon: IconFilePlus,
	},
];

export const SIDEBAR_NAV_ROUTES = APP_PAGE_ROUTES.filter(
	(
		route,
	): route is AppPageRoute & {
		sidebar: true;
		icon: NavigationIcon;
	} => route.sidebar === true && !!route.icon,
);
