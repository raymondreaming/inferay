/** Pure state transitions shared by the diff viewer and its rendering children. */
import type { DiffScrollSource, DiffViewMode } from "@repository/model/diff.ts";

export type { DiffViewMode };
export const MAX_RENDERED_LINE_CHARS = 4000;

export type DiffViewportState = {
	scrollTop: number;
	viewHeight: number;
};

export const INITIAL_DIFF_VIEWPORT_STATE = {
	scrollTop: 0,
	viewHeight: 600,
} satisfies DiffViewportState;

export function diffViewportReducer(
	state: DiffViewportState,
	action: { type: "measure"; height: number } | { type: "scroll"; top: number },
): DiffViewportState {
	const field = action.type === "measure" ? "viewHeight" : "scrollTop";
	const value =
		action.type === "measure"
			? action.height || INITIAL_DIFF_VIEWPORT_STATE.viewHeight
			: action.top;
	return Math.abs(state[field] - value) > 0.5
		? {
				...state,
				[field]: value,
			}
		: state;
}

export type DiffNavigationState = {
	externalScrollSource: DiffScrollSource;
	externalScrollTop: number;
	highlightedChangeIdx: number | undefined;
};

export const INITIAL_DIFF_NAVIGATION_STATE = {
	externalScrollSource: "all",
	externalScrollTop: -1,
	highlightedChangeIdx: undefined,
} satisfies DiffNavigationState;

export function diffNavigationReducer(
	state: DiffNavigationState,
	action:
		| { type: "clearHighlight" | "clearScroll" | "reset" }
		| { type: "jumpToChange"; changeIdx: number; top: number }
		| { type: "jumpToPosition"; source: DiffScrollSource; top: number },
): DiffNavigationState {
	let next: DiffNavigationState;
	switch (action.type) {
		case "clearHighlight":
			next = { ...state, highlightedChangeIdx: undefined };
			break;
		case "clearScroll":
			next = { ...state, externalScrollTop: -1, externalScrollSource: "all" };
			break;
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
			next = INITIAL_DIFF_NAVIGATION_STATE;
			break;
	}
	return state.externalScrollSource === next.externalScrollSource &&
		state.externalScrollTop === next.externalScrollTop &&
		state.highlightedChangeIdx === next.highlightedChangeIdx
		? state
		: next;
}
