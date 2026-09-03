export type OnboardingStep = "intro" | "github" | "projects" | "complete";
export type StateValue<T> = T | ((current: T) => T);

export interface OnboardingState {
	step: OnboardingStep;
	connecting: boolean;
	localFolders: string[];
	isAddingFolder: boolean;
	selectedRepos: Set<string>;
}

export type OnboardingAction =
	| { type: "stepChanged"; value: OnboardingStep }
	| { type: "connectingChanged"; value: StateValue<boolean> }
	| { type: "localFoldersChanged"; value: StateValue<string[]> }
	| { type: "isAddingFolderChanged"; value: StateValue<boolean> }
	| { type: "selectedReposChanged"; value: StateValue<Set<string>> };

export const initialOnboardingState: OnboardingState = {
	step: "intro",
	connecting: false,
	localFolders: [],
	isAddingFolder: false,
	selectedRepos: new Set(),
};

function resolveStateValue<T>(current: T, value: StateValue<T>): T {
	return typeof value === "function"
		? (value as (current: T) => T)(current)
		: value;
}

export function onboardingReducer(
	state: OnboardingState,
	action: OnboardingAction,
): OnboardingState {
	switch (action.type) {
		case "stepChanged":
			return state.step === action.value
				? state
				: { ...state, step: action.value };
		case "connectingChanged": {
			const connecting = resolveStateValue(state.connecting, action.value);
			return state.connecting === connecting ? state : { ...state, connecting };
		}
		case "localFoldersChanged": {
			const localFolders = resolveStateValue(state.localFolders, action.value);
			return state.localFolders === localFolders
				? state
				: { ...state, localFolders };
		}
		case "isAddingFolderChanged": {
			const isAddingFolder = resolveStateValue(
				state.isAddingFolder,
				action.value,
			);
			return state.isAddingFolder === isAddingFolder
				? state
				: { ...state, isAddingFolder };
		}
		case "selectedReposChanged": {
			const selectedRepos = resolveStateValue(
				state.selectedRepos,
				action.value,
			);
			return state.selectedRepos === selectedRepos
				? state
				: { ...state, selectedRepos };
		}
	}
}

export function getStepPhase(current: OnboardingStep, target: OnboardingStep) {
	const order: OnboardingStep[] = ["intro", "github", "projects", "complete"];
	const currentIndex = order.indexOf(current);
	const targetIndex = order.indexOf(target);
	if (currentIndex === targetIndex) return "active" as const;
	return currentIndex < targetIndex ? ("before" as const) : ("after" as const);
}
