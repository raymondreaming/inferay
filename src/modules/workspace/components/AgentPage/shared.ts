import { lazy } from "octane";
import type { AgentMainView } from "../../../../app/model/navigation.tsx";
import type {
	AgentLayoutMode,
	AgentSavedState,
	GroupId,
	ThemeId,
} from "../../model/workspace-model.ts";

export const Settings = lazy(() =>
	import("../../../settings/components/Settings/index.tsx").then((module) => ({
		default: module.Settings,
	})),
);

export type MutableRef<T> = {
	current: T;
};

type AgentAppearance = {
	readonly themeId: ThemeId;
	readonly fontSize: number;
	readonly fontFamily: string;
	readonly opacity: number;
};

export type AgentPersistenceArgs = AgentAppearance & {
	readonly groups: AgentSavedState["groups"];
	readonly latestStateRef: MutableRef<AgentSavedState>;
	readonly mainView: AgentMainView;
	readonly mainViewHealthRef: MutableRef<{
		timestamp: number | null;
		view: AgentMainView;
	}>;
	readonly mainViewRef: MutableRef<AgentMainView>;
	readonly restoreSavedState: (state: AgentSavedState | null) => void;
	readonly selectedGroupId: GroupId | null;
	readonly setAppearance: (
		value: AgentAppearance | ((previous: AgentAppearance) => AgentAppearance),
	) => void;
	readonly setLayoutMode: (value: AgentLayoutMode) => void;
	readonly setMainView: (value: AgentMainView) => void;
	readonly setSelectedGroupId: (value: GroupId | null) => void;
};
