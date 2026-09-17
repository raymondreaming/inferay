import type { OnboardingTour } from "@contracts";
import {
	listenWindowEvent,
	OPEN_ONBOARDING_EVENT,
	setActiveGitGraphVisible,
	setActiveGitSidebarVisible,
	TOGGLE_ACTIVE_GIT_GRAPH_EVENT,
	TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT,
} from "@shared/lib/dom.tsx";
import {
	loadSidebarCollapsed,
	project,
	readStoredJson,
	ONBOARDING_STORAGE_KEY as STORAGE_KEY,
	setWorkspaceSidebarCollapsed,
	writeStoredJson,
} from "@shared/lib/native.tsx";
import { useWorkspaceState } from "@workspace/hooks/useWorkspaceState.tsx";
import {
	createEffect,
	createMemo,
	createSignal,
	onSettled,
	untrack,
} from "solid-js";

const GRAPH_SELECTOR = '[aria-label="Repository commit history"]';
const CHANGES_SELECTOR = '[aria-label="Resize changes sidebar"]';
const WORKSPACE_SELECTOR = "[data-chat-workspace]";

export interface OnboardingProgress {
	status: "new" | "running" | "done" | "skipped";
	step: string;
	visited: string[];
}
interface ObservedFacts {
	graphOpen: boolean;
	changesVisible: boolean;
	folderChosen: boolean;
}
const NEW_PROGRESS: OnboardingProgress = {
	status: "new",
	step: "welcome",
	visited: [],
};
const NO_FACTS: ObservedFacts = {
	graphOpen: false,
	changesVisible: false,
	folderChosen: false,
};

export function useOnboardingTour() {
	const [progress, setProgress] = createSignal(
		readStoredJson<OnboardingProgress>(STORAGE_KEY, NEW_PROGRESS),
	);
	const [observed, setObserved] = createSignal(NO_FACTS, {
		equals: (previous, next) =>
			previous.graphOpen === next.graphOpen &&
			previous.changesVisible === next.changesVisible &&
			previous.folderChosen === next.folderChosen,
	});
	const [shellState] = useWorkspaceState(() => false);
	const openedRepository = createMemo(() =>
		shellState().groups.some((group) => group.panes.some((pane) => !!pane.cwd)),
	);
	const facts = createMemo(() => ({
		...observed(),
		hasMessage: openedRepository(),
		repositoryChosen:
			observed().folderChosen ||
			shellState().repositories.workspaces.length > 0 ||
			shellState().groups.some((group) =>
				group.panes.some((pane) => !!pane.cwd),
			),
	}));
	const tour = createMemo(() =>
		project<OnboardingTour>("onboardingTour", {
			progress: progress(),
			facts: facts(),
		}),
	);
	const advance = (action: string) => {
		const current = progress();
		const next = project<OnboardingProgress>("onboardingAdvance", {
			progress: { ...current, step: tour().step?.id ?? current.step },
			action,
		});
		setProgress(next);
		writeStoredJson(STORAGE_KEY, next);
	};
	const decided = { current: false };
	createEffect(
		() => shellState().groups.length > 0 && progress().status === "new",
		(undecided) => {
			if (!undecided || decided.current) return;
			decided.current = true;
			advance(openedRepository() ? "dismiss" : "start");
		},
	);
	const panelsTouched = { current: false };
	onSettled(() => {
		const watch = (event: Event) => {
			if (
				(event as CustomEvent<{ visible?: boolean }>).detail?.visible ===
				undefined
			)
				panelsTouched.current = true;
		};
		const stop = [
			listenWindowEvent(TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT, watch),
			listenWindowEvent(TOGGLE_ACTIVE_GIT_GRAPH_EVENT, watch),
		];
		return () => stop.forEach((remove) => remove());
	});
	createEffect(
		() => tour().active,
		(active) => {
			if (!active) return;
			let frame = 0;
			const read = () => {
				frame = 0;
				setObserved({
					graphOpen: Boolean(document.querySelector(GRAPH_SELECTOR)),
					changesVisible: Boolean(document.querySelector(CHANGES_SELECTOR)),
					folderChosen: Boolean(document.querySelector(WORKSPACE_SELECTOR)),
				});
			};
			read();
			const observer = new MutationObserver(() => {
				if (!frame) frame = requestAnimationFrame(read);
			});
			observer.observe(document.body, { childList: true, subtree: true });
			return () => {
				cancelAnimationFrame(frame);
				observer.disconnect();
			};
		},
	);
	const step = createMemo(() => tour().step);
	const enteredDone = { current: false };
	const stagedStep = { current: "" };
	const collapsedBeforeTour = { current: null as boolean | null };
	createEffect(
		() => tour().active,
		(active) => {
			if (active) {
				collapsedBeforeTour.current ??= loadSidebarCollapsed();
				return;
			}
			if (collapsedBeforeTour.current === null) return;
			const finished = untrack(progress).status === "done";
			setWorkspaceSidebarCollapsed(
				finished ? false : collapsedBeforeTour.current,
			);
			if (finished) setActiveGitSidebarVisible(true);
			collapsedBeforeTour.current = null;
		},
	);
	createEffect(
		() =>
			tour().active
				? `${step()?.id ?? ""}:${observed().changesVisible}:${observed().graphOpen}`
				: null,
		(key) => {
			if (!key) return;
			const staged = untrack(step);
			const id = staged?.id ?? "";
			if (id !== stagedStep.current) {
				stagedStep.current = id;
				enteredDone.current = !!staged?.task && !!staged.taskDone;
			}
			if (panelsTouched.current) return;
			const seen = untrack(observed);
			if (
				staged?.sidebar !== null &&
				staged?.sidebar !== undefined &&
				!staged.sidebar !== loadSidebarCollapsed()
			)
				setWorkspaceSidebarCollapsed(!staged.sidebar);
			if (
				staged?.changes !== null &&
				staged?.changes !== undefined &&
				staged.changes !== seen.changesVisible
			)
				setActiveGitSidebarVisible(staged.changes);
			if (
				staged?.graph !== null &&
				staged?.graph !== undefined &&
				staged.graph !== seen.graphOpen
			)
				setActiveGitGraphVisible(staged.graph);
		},
	);
	createEffect(
		() =>
			tour().active && step()?.task && step()?.taskDone
				? (step()?.id ?? null)
				: null,
		(id) => {
			if (!id) return;
			const silent = !untrack(step)?.card;
			if (enteredDone.current && !silent) return;
			const timer = setTimeout(() => advance("next"), silent ? 300 : 900);
			return () => clearTimeout(timer);
		},
	);
	onSettled(() =>
		listenWindowEvent(OPEN_ONBOARDING_EVENT, () => {
			panelsTouched.current = false;
			advance("restart");
		}),
	);
	return { tour, advance };
}
