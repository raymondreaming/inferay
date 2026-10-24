import type { DropdownPosition } from "@contracts";
import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { px } from "@shared/lib/dom.tsx";
import { Dynamic, Portal } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	type Element,
	For,
	onSettled,
	Show,
} from "solid-js";
import { project } from "../../lib/native.tsx";
import { IconCheck, IconChevronDown } from "../Icons/index.tsx";
import { TextInput } from "../TextInput/index.tsx";
import { styles } from "./styles.ts";

export interface DropdownOption {
	iconComponent?: import("solid-js").Component;
	id: string;
	label: string;
	detail?: string;
	status?: string;
	icon?: import("solid-js").Element;
}

export function DropdownButton(props: {
	value: string | null;
	customOption?: (text: string) => DropdownOption | null;
	searchPlaceholder?: string;
	variant?: "default" | "ghost";
	size?: "sm";
	title?: string;
	selectedLabel?: string;
	disabled?: boolean;
	label?: string;
	options: readonly DropdownOption[];
	onChange: (id: string) => void;
	placeholder?: string;
	icon?: Element;
	emptyLabel?: string;
	minWidth?: number;
	fullWidth?: boolean;
	buttonClassName?: string;
	menuPlacement?: "auto" | "top" | "bottom";
	maxVisibleOptions?: number;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const [localOpen, setLocalOpen] = createSignal(false);
	const open = () => props.open ?? localOpen();
	const setOpen = (value: boolean) => {
		if (props.open === undefined) setLocalOpen(value);
		props.onOpenChange?.(value);
	};
	let trigger!: HTMLButtonElement;
	const selected = createMemo(() =>
		props.options.find((option) => option.id === props.value),
	);
	const buttonProps = createMemo(() =>
		stylex.attrs(
			styles.button,
			props.fullWidth && styles.fullWidth,
			open() ? styles.buttonOpen : styles.buttonClosed,
			props.variant === "ghost" && styles.buttonGhost,
			props.size === "sm" && styles.buttonSmall,
		),
	);
	return (
		<>
			<button
				type="button"
				disabled={props.disabled}
				title={props.title}
				aria-haspopup="menu"
				aria-label={props.label}
				aria-expanded={open() ? "true" : "false"}
				ref={(element) => {
					trigger = element;
				}}
				onClick={() => setOpen(!open())}
				{...buttonProps()}
				class={`${buttonProps().class ?? ""} ${props.buttonClassName ?? ""}`}
			>
				{props.icon}
				<span
					{...stylex.attrs(
						styles.buttonLabel,
						props.fullWidth && styles.buttonLabelFull,
						selected() ? styles.buttonLabelSelected : styles.buttonLabelMuted,
					)}
				>
					{props.selectedLabel ??
						(selected()?.label || props.placeholder || "Select...")}
				</span>
				<IconChevronDown
					size={iconSize.sm}
					class={
						stylex.attrs(styles.chevron, open() && styles.chevronOpen).class
					}
				/>
			</button>
			<Show when={open()}>
				<Portal mount={trigger.closest("dialog") ?? document.body}>
					<DropdownMenu
						config={props}
						trigger={trigger}
						close={() => setOpen(false)}
					/>
				</Portal>
			</Show>
		</>
	);
}

function DropdownMenu(props: {
	config: Parameters<typeof DropdownButton>[0];
	trigger: HTMLButtonElement;
	close: () => void;
}) {
	const config = props.config;
	const [search, setSearch] = createSignal("");
	const [resize, setResize] = createSignal(0);
	const [contentHeight, setContentHeight] = createSignal<number>();
	const [searchHeight, setSearchHeight] = createSignal(38);
	let menu!: HTMLDivElement;
	let optionsBox!: HTMLDivElement;
	let searchInput: HTMLInputElement | undefined;
	const showSearch = createMemo(() => config.options.length > 5);
	const position = createMemo(() => {
		void resize();
		return project<DropdownPosition>("dropdownPosition", {
			placement: config.menuPlacement ?? "auto",
			rowHeight: 30,
			count: config.options.length,
			maxVisible: config.maxVisibleOptions,
			contentHeight: contentHeight(),
			minWidth: config.minWidth ?? 220,
			rect: props.trigger.getBoundingClientRect(),
			width: window.innerWidth,
			height: window.innerHeight,
		});
	});
	const measure = () => {
		const searchSize =
			searchInput?.parentElement?.getBoundingClientRect().height ?? 0;
		const options = Array.from(optionsBox.children);
		setSearchHeight(searchSize);
		setContentHeight(
			options
				.slice(0, config.maxVisibleOptions ?? options.length)
				.reduce(
					(height, option) => height + option.getBoundingClientRect().height,
					searchSize + 2,
				),
		);
		setResize((value) => value + 1);
	};
	onSettled(() => {
		const observer = new ResizeObserver(measure);
		observer.observe(props.trigger);
		observer.observe(menu);
		const dismissOutside = (event: Event) => {
			if (
				!menu.contains(event.target as Node) &&
				(event.type === "scroll" ||
					!props.trigger.contains(event.target as Node))
			)
				props.close();
		};
		const dismissEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			props.close();
			props.trigger.focus();
		};
		window.addEventListener("resize", measure);
		document.addEventListener("mousedown", dismissOutside);
		window.addEventListener("scroll", dismissOutside, true);
		document.addEventListener("keydown", dismissEscape, true);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
			document.removeEventListener("mousedown", dismissOutside);
			window.removeEventListener("scroll", dismissOutside, true);
			document.removeEventListener("keydown", dismissEscape, true);
		};
	});
	const filtered = createMemo(() => {
		const text = search();
		if (!text) return config.options;
		const needle = text.toLowerCase();
		const matches = config.options.filter(
			(option) =>
				option.label.toLowerCase().includes(needle) ||
				option.detail?.toLowerCase().includes(needle) ||
				option.status?.toLowerCase().includes(needle),
		);
		const custom = config.customOption?.(text);
		return custom
			? [custom, ...matches.filter((option) => option.id !== custom.id)]
			: matches;
	});
	createEffect(filtered, () => {
		queueMicrotask(() => {
			if (menu.isConnected) measure();
		});
	});
	const SearchBox = () => (
		<Show when={showSearch()}>
			<div {...stylex.attrs(styles.searchWrap)}>
				<TextInput
					ref={(element) => {
						searchInput = element;
						queueMicrotask(() => {
							if (element.isConnected) element.focus();
						});
					}}
					size="sm"
					fullWidth
					value={search()}
					onInput={(event) => setSearch(event.currentTarget.value)}
					placeholder={config.searchPlaceholder ?? "Search…"}
					class={stylex.attrs(styles.searchInput).class}
				/>
			</div>
		</Show>
	);
	const OptionsBox = () => (
		<div
			ref={(element) => {
				optionsBox = element;
			}}
			{...stylex.attrs(styles.optionsBox)}
			style={{
				"max-height": px(Math.max(0, position().maxH - searchHeight() - 2)),
			}}
		>
			{filtered().length === 0 ? (
				<p {...stylex.attrs(styles.empty)}>
					{search() ? "No matches" : (config.emptyLabel ?? "No options")}
				</p>
			) : (
				<For each={filtered()} keyed={(row) => row.id}>
					{(opt) => (
						<button
							type="button"
							role="menuitemradio"
							title={opt().status}
							aria-checked={opt().id === config.value ? "true" : "false"}
							tabindex={-1}
							onClick={() => {
								config.onChange(opt().id);
								props.close();
								props.trigger.focus();
							}}
							{...stylex.attrs(
								styles.option,
								opt().id === config.value && styles.optionSelected,
							)}
						>
							{(opt().icon || opt().iconComponent) && (
								<span {...stylex.attrs(styles.optionIcon)}>
									{opt().iconComponent ? (
										<Dynamic component={opt().iconComponent} />
									) : (
										opt().icon
									)}
								</span>
							)}
							<div {...stylex.attrs(styles.optionContent)}>
								<span {...stylex.attrs(styles.optionLabel)}>{opt().label}</span>
								{opt().detail && (
									<span
										{...stylex.attrs(
											styles.detailBadge,
											(opt().detail?.includes("★") ||
												opt().detail?.includes("Best")) &&
												styles.detailBadgeFeatured,
										)}
									>
										{opt().detail}
									</span>
								)}
								{opt().status && (
									<span {...stylex.attrs(styles.optionStatus)}>
										{opt().status}
									</span>
								)}
							</div>
							{opt().id === config.value && <IconCheck size={iconSize.sm} />}
						</button>
					)}
				</For>
			)}
		</div>
	);
	const onTop = () => position().placement === "top";
	return (
		<div
			popover="manual"
			role="menu"
			aria-label={config.label}
			tabindex={-1}
			onKeyDown={(event) => {
				if (event.key === "Tab") {
					props.trigger.focus();
					props.close();
					return;
				}
				if (event.target === searchInput && !event.key.startsWith("Arrow"))
					return;
				const buttons = Array.from(
					menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
				);
				const index = buttons.indexOf(
					document.activeElement as HTMLButtonElement,
				);
				const next =
					event.key === "Home"
						? 0
						: event.key === "End"
							? buttons.length - 1
							: event.key === "ArrowDown"
								? (index + 1) % buttons.length
								: event.key === "ArrowUp"
									? index < 0
										? buttons.length - 1
										: (index - 1 + buttons.length) % buttons.length
									: -1;
				if (next >= 0) {
					event.preventDefault();
					buttons[next]?.focus();
				}
			}}
			ref={(element) => {
				menu = element;
				queueMicrotask(() => {
					if (element.isConnected) {
						element.showPopover();
						(
							searchInput ??
							menu.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
							menu.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
						)?.focus();
					}
				});
			}}
			{...stylex.attrs(surfaceStyles.overlay, styles.menu)}
			style={{
				top: onTop() ? undefined : px(position().top),
				bottom: onTop() ? px(position().bottom) : undefined,
				left: px(position().left),
				"min-width": px(position().width),
				"max-height": px(position().maxH),
			}}
		>
			<Show
				when={onTop()}
				fallback={
					<>
						<SearchBox />
						<OptionsBox />
					</>
				}
			>
				<OptionsBox />
				<Show when={showSearch()}>
					<div {...stylex.attrs(styles.topSearchDivider)}>
						<SearchBox />
					</div>
				</Show>
			</Show>
		</div>
	);
}
