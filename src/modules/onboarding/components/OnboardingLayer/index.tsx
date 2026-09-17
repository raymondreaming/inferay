import type { OnboardingRect, OnboardingStep } from "@contracts";
import { useOnboardingTour } from "@onboarding/hooks/useOnboardingTour.tsx";
import { domStyle, listenWindowEvent } from "@shared/lib/dom.tsx";
import { project } from "@shared/lib/native.tsx";
import { BorderBeamOverlay } from "@shared/ui/BorderBeamOverlay/index.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
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

export function OnboardingLayer() {
	const { tour, advance } = useOnboardingTour();
	const step = createMemo<OnboardingStep | null>(() => tour().step);
	const [anchor, setAnchor] = createSignal<Rect | null>(null, {
		equals: sameRect,
	});
	const [viewport, setViewport] = createSignal(
		{ x: 0, y: 0, width: 0, height: 0 },
		{ equals: sameRect },
	);
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
	const spotlight = createMemo(() =>
		tour().active
			? project<OnboardingRect | null>("onboardingSpotlight", {
					anchor: anchor(),
					viewport: viewport(),
				})
			: null,
	);
	return (
		<Show when={spotlight()}>
			{(rect) => (
				<div {...stylex.attrs(styles.root)}>
					<div
						{...stylex.attrs(styles.spotlight)}
						style={domStyle(
							inlineStyles.getSpotlightStyle(
								rect().x,
								rect().y,
								rect().width,
								rect().height,
								beamScale(rect().width, rect().height),
							),
						)}
					>
						<BorderBeamOverlay active={!step()?.taskDone} />
					</div>
				</div>
			)}
		</Show>
	);
}
