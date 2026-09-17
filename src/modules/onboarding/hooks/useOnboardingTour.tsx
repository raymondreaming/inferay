import type { OnboardingTour } from "@contracts";
import {
	dispatchCreateAgentChat,
	dispatchOpenActiveGitGraph,
	listenWindowEvent,
	OPEN_ONBOARDING_EVENT,
	setActiveGitGraphVisible,
	setActiveGitSidebarVisible,
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
const DIFF_SELECTOR = "[data-diff-scroll-side]";
const CHANGES_SELECTOR = '[aria-label="Resize changes sidebar"]';
const CHAT_PANE_SELECTOR = "[data-chat-pane-id]";
const WORKSPACE_SELECTOR = "[data-chat-workspace]";

export interface OnboardingProgress {
	status: "new" | "running" | "done" | "skipped";
	step: string;
	visited: string[];
}
interface ObservedFacts {
	graphOpen: boolean;
	diffOpen: boolean;
	changesVisible: boolean;
	secondChat: boolean;
	folderChosen: boolean;
}
const NEW_PROGRESS: OnboardingProgress = {
	status: "new",
	step: "welcome",
	visited: [],
};
const NO_FACTS: ObservedFacts = {
	graphOpen: false,
	diffOpen: false,
	changesVisible: false,
	secondChat: false,
	folderChosen: false,
};

export function useOnboardingTour() {
	const [progress, setProgress] = createSignal(
		readStoredJson<OnboardingProgress>(STORAGE_KEY, NEW_PROGRESS),
	);
	const [observed, setObserved] = createSignal(NO_FACTS, {
		equals: (previous, next) =>
			previous.graphOpen === next.graphOpen &&
			previous.diffOpen === next.diffOpen &&
			previous.changesVisible === next.changesVisible &&
			previous.secondChat === next.secondChat &&
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
	createEffect(
		() => tour().active,
		(active) => {
			if (!active) return;
			let frame = 0;
			const read = () => {
				frame = 0;
				setObserved({
					graphOpen: Boolean(document.querySelector(GRAPH_SELECTOR)),
					diffOpen: Boolean(document.querySelector(DIFF_SELECTOR)),
					changesVisible: Boolean(document.querySelector(CHANGES_SELECTOR)),
					secondChat: document.querySelectorAll(CHAT_PANE_SELECTOR).length > 1,
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
			setWorkspaceSidebarCollapsed(collapsedBeforeTour.current);
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
		listenWindowEvent(OPEN_ONBOARDING_EVENT, () => advance("restart")),
	);
	return {
		tour,
		advance,
		runStepAction: (action: string) => {
			if (action === "newChat") dispatchCreateAgentChat();
			else if (action === "openGraph") dispatchOpenActiveGitGraph();
		},
	};
}
