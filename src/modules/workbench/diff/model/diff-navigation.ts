import type { DiffScrollSource } from "../hooks/useSplitDiffScroll.tsx";

export interface DiffNavigationState {
	externalScrollSource: DiffScrollSource;
	externalScrollTop: number;
	highlightedChangeIdx: number | undefined;
}

export interface DiffViewportState {
	scrollTop: number;
	viewHeight: number;
}

export type DiffNavigationAction =
	| { type: "clearHighlight" }
	| { type: "clearScroll" }
	| { type: "jumpToChange"; changeIdx: number; top: number }
	| { type: "jumpToPosition"; source: DiffScrollSource; top: number }
	| { type: "reset" };

export type DiffViewportAction =
	| { type: "measure"; height: number }
	| { type: "scroll"; top: number };

export const INITIAL_DIFF_NAVIGATION_STATE: DiffNavigationState = {
	externalScrollSource: "all",
	externalScrollTop: -1,
	highlightedChangeIdx: undefined,
};

export const INITIAL_DIFF_VIEWPORT_STATE: DiffViewportState = {
	scrollTop: 0,
	viewHeight: 600,
};

export function diffNavigationReducer(
	state: DiffNavigationState,
	action: DiffNavigationAction,
): DiffNavigationState {
	switch (action.type) {
		case "clearHighlight":
			return state.highlightedChangeIdx === undefined
				? state
				: { ...state, highlightedChangeIdx: undefined };
		case "clearScroll":
			return state.externalScrollTop === -1 &&
				state.externalScrollSource === "all"
				? state
				: { ...state, externalScrollSource: "all", externalScrollTop: -1 };
		case "jumpToChange":
			return {
				externalScrollSource: "all",
				externalScrollTop: action.top,
				highlightedChangeIdx: action.changeIdx,
			};
		case "jumpToPosition":
			return {
				...state,
				externalScrollSource: action.source,
				externalScrollTop: action.top,
			};
		case "reset":
			return state.externalScrollSource === "all" &&
				state.externalScrollTop === -1 &&
				state.highlightedChangeIdx === undefined
				? state
				: INITIAL_DIFF_NAVIGATION_STATE;
	}
}

export function diffViewportReducer(
	state: DiffViewportState,
	action: DiffViewportAction,
): DiffViewportState {
	switch (action.type) {
		case "measure": {
			const nextHeight =
				action.height || INITIAL_DIFF_VIEWPORT_STATE.viewHeight;
			return Math.abs(state.viewHeight - nextHeight) > 0.5
				? { ...state, viewHeight: nextHeight }
				: state;
		}
		case "scroll":
			return Math.abs(state.scrollTop - action.top) > 0.5
				? { ...state, scrollTop: action.top }
				: state;
	}
}
