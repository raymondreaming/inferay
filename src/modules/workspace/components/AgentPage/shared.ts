import { lazy } from "octane";
export const Settings = lazy(() =>
	import("../../../settings/components/Settings/index.tsx").then((module) => ({
		default: module.Settings,
	})),
);

export type MutableRef<T> = {
	current: T;
};
