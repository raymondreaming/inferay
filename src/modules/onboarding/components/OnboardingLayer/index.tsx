import type { OnboardingCallout, OnboardingStep } from "@contracts";
import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { useOnboardingTour } from "@onboarding/hooks/useOnboardingTour.tsx";
import { domStyle, listenWindowEvent } from "@shared/lib/dom.tsx";
import { project } from "@shared/lib/native.tsx";
import { BorderBeamOverlay } from "@shared/ui/BorderBeamOverlay/index.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import {
	IconCheck,
	IconSparkles,
	IconTarget,
	IconX,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
	Show,
	untrack,
} from "solid-js";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}
const DEFAULT_CARD: Rect = { x: 0, y: 0, width: 344, height: 280 };
const sameRect = (previous: Rect | null, next: Rect | null) =>
	previous === next ||
	(!!previous &&
		!!next &&
		previous.x === next.x &&
		previous.y === next.y &&
		previous.width === next.width &&
		previous.height === next.height);
const beamScale = (width: number, height: number) =>
	Math.min(4, Math.max(1, Math.max(width, height) / 600));
const ARROW_SHAPE: Record<string, string> = {
	right: "polygon(0% 0%, 0% 100%, 100% 100%)",
	left: "polygon(0% 0%, 100% 0%, 100% 100%)",
	bottom: "polygon(0% 0%, 100% 0%, 0% 100%)",
	top: "polygon(100% 0%, 100% 100%, 0% 100%)",
};

export function OnboardingLayer() {
	const { tour, advance, runStepAction } = useOnboardingTour();
	const step = createMemo<OnboardingStep | null>(() => tour().step);
	const [anchor, setAnchor] = createSignal<Rect | null>(null, {
		equals: sameRect,
	});
	const [card, setCard] = createSignal<Rect>(DEFAULT_CARD, {
		equals: sameRect,
	});
	const [viewport, setViewport] = createSignal(
		{ x: 0, y: 0, width: 0, height: 0 },
		{ equals: sameRect },
	);
	const [measured, setMeasured] = createSignal(false);
	let cardElement: HTMLDivElement | undefined;
	createEffect(
		() => tour().active,
		(active) => {
			if (!active) return;
			let frame = 0;
			const measure = () => {
				frame = requestAnimationFrame(measure);
				const element = (step()?.anchors ?? []).reduce<HTMLElement | null>(
					(found, selector) =>
						found ?? document.querySelector<HTMLElement>(selector),
					null,
				);
				const bounds = element?.getBoundingClientRect();
				setAnchor(
					bounds && bounds.width > 0 && bounds.height > 0
						? {
								x: bounds.left,
								y: bounds.top,
								width: bounds.width,
								height: bounds.height,
							}
						: null,
				);
				const shape = cardElement?.getBoundingClientRect();
				if (shape?.height) {
					setCard({ x: 0, y: 0, width: shape.width, height: shape.height });
					setMeasured(true);
				}
				setViewport({
					x: 0,
					y: 0,
					width: window.innerWidth,
					height: window.innerHeight,
				});
			};
			measure();
			return () => cancelAnimationFrame(frame);
		},
	);
	onSettled(() =>
		listenWindowEvent("keydown", (event) => {
			if (event.key !== "Escape" || !tour().active || event.defaultPrevented)
				return;
			event.preventDefault();
			advance("skip");
		}),
	);
	createEffect(
		() => (tour().active ? (step()?.id ?? null) : null),
		() => {
			const current = untrack(step);
			const selector = current?.anchors[0];
			const placeholder = current?.placeholder;
			if (!selector || !placeholder) return;
			const field = document
				.querySelector(selector)
				?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
					"input, textarea",
				);
			if (!field) return;
			const original = field.placeholder;
			field.placeholder = placeholder;
			return () => {
				field.placeholder = original;
			};
		},
	);
	createEffect(
		() => (tour().active ? (step()?.id ?? null) : null),
		(id) => {
			if (!id) return;
			const anchors = untrack(step)?.anchors ?? [];
			if (anchors.length < 2 || document.querySelector(anchors[0])) return;
			const opener = document.querySelector<HTMLElement>(
				anchors[anchors.length - 1],
			);
			const frame = requestAnimationFrame(() => {
				if (!document.querySelector(anchors[0])) opener?.click();
			});
			return () => cancelAnimationFrame(frame);
		},
	);
	createEffect(
		() => (tour().active ? (step()?.anchors[0] ?? "") : null),
		(anchor) => {
			const composer = document.querySelector<HTMLElement>(
				"[data-chat-composer-frame]",
			);
			if (!composer || anchor === null) return;
			if (anchor === "[data-chat-composer-frame]") return;
			composer.dataset.beamQuiet = "true";
			return () => {
				delete composer.dataset.beamQuiet;
			};
		},
	);
	const callout = createMemo(() =>
		project<OnboardingCallout>("onboardingCallout", {
			anchor: anchor(),
			card: card(),
			viewport: viewport(),
			placement: step()?.placement ?? "center",
			tight: step()?.tight ?? false,
		}),
	);
	const currentStep = createMemo(() => (tour().active ? step() : null));
	return (
		<Show when={currentStep()}>
			{(active) => (
				<div {...stylex.attrs(styles.root)}>
					<Show when={callout().spotlight}>
						{(spotlight) => (
							<div
								{...stylex.attrs(
									styles.spotlight,
									active().tight && styles.spotlightTight,
								)}
								style={domStyle(
									inlineStyles.getSpotlightStyle(
										spotlight().x,
										spotlight().y,
										spotlight().width,
										spotlight().height,
										beamScale(spotlight().width, spotlight().height),
									),
								)}
							>
								<BorderBeamOverlay
									active={!active().task || !active().taskDone}
								/>
							</div>
						)}
					</Show>
					<Show when={active().card}>
						<div
							ref={(element) => (cardElement = element)}
							role="dialog"
							aria-label={`Onboarding: ${active().title}`}
							{...stylex.attrs(
								surfaceStyles.overlay,
								styles.card,
								styles.beamHost,
							)}
							style={domStyle(
								inlineStyles.getCardStyle(
									`translate3d(${callout().card.x}px, ${callout().card.y}px, 0)`,
									measured() ? 1 : 0,
								),
							)}
						>
							<Show when={!callout().spotlight}>
								<BorderBeamOverlay active={true} />
							</Show>
							<Show when={callout().arrow}>
								{(arrow) => (
									<span
										aria-hidden="true"
										{...stylex.attrs(styles.arrow)}
										style={domStyle(
											inlineStyles.getArrowStyle(
												callout().side === "left"
													? callout().card.width - 5
													: callout().side === "right"
														? -5
														: arrow().x - 5,
												callout().side === "top"
													? callout().card.height - 5
													: callout().side === "bottom"
														? -5
														: arrow().y - 5,
												ARROW_SHAPE[callout().side] ?? "none",
											),
										)}
									/>
								)}
							</Show>
							<div {...stylex.attrs(styles.header)}>
								<span {...stylex.attrs(styles.eyebrow)}>
									<Show when={active().first || active().last}>
										<IconSparkles size={iconSize.sm} />
									</Show>
									{active().act}
								</span>
								<span {...stylex.attrs(styles.headerEnd)}>
									<IconButton
										type="button"
										variant="ghost"
										size="sm"
										aria-label="Skip the tour"
										title="Skip the tour"
										onClick={() => advance("skip")}
									>
										<IconX size={iconSize.sm} />
									</IconButton>
								</span>
							</div>
							<h2 {...stylex.attrs(styles.title)}>{active().title}</h2>
							<p {...stylex.attrs(styles.body)}>{active().body}</p>
							<Show when={active().hotkeys.length}>
								<div {...stylex.attrs(styles.keys)}>
									<For each={active().hotkeys}>
										{(hotkey) => (
											<div {...stylex.attrs(styles.keyRow)}>
												<span {...stylex.attrs(styles.keyCluster)}>
													<For each={hotkey.keys}>
														{(key) => (
															<kbd {...stylex.attrs(styles.key)}>{key}</kbd>
														)}
													</For>
												</span>
												{hotkey.label}
											</div>
										)}
									</For>
								</div>
							</Show>
							<Show when={active().task}>
								{(task) => (
									<div
										{...stylex.attrs(
											styles.task,
											active().taskDone && styles.taskDone,
										)}
									>
										<span {...stylex.attrs(styles.taskIcon)}>
											<Show
												when={active().taskDone}
												fallback={<IconTarget size={iconSize.md} />}
											>
												<IconCheck size={iconSize.md} />
											</Show>
										</span>
										{active().taskDone ? "Done" : task()}
									</div>
								)}
							</Show>
							<div {...stylex.attrs(styles.actions)}>
								<span {...stylex.attrs(styles.trail)}>
									<For each={tour().steps}>
										{(marker) => (
											<span
												{...stylex.attrs(
													styles.dot,
													marker.visited && styles.dotVisited,
													marker.current && styles.dotCurrent,
												)}
											/>
										)}
									</For>
								</span>
								<span {...stylex.attrs(styles.buttons)}>
									<Show when={!active().first}>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => advance("back")}
										>
											Back
										</Button>
									</Show>
									<Show
										when={active().action}
										fallback={
											<Button
												variant="secondary"
												size="sm"
												disabled={!active().canAdvance}
												onClick={() =>
													advance(active().last ? "finish" : "next")
												}
											>
												{active().primaryLabel}
											</Button>
										}
									>
										{(action) => (
											<Button
												variant="secondary"
												size="sm"
												onClick={() => runStepAction(action())}
											>
												{active().actionLabel}
											</Button>
										)}
									</Show>
								</span>
							</div>
						</div>
					</Show>
				</div>
			)}
		</Show>
	);
}
