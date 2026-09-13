import { Portal } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import {
	iconSize,
	runtimeColor,
} from "../../../design-system/styles.stylex.ts";
import { domStyle, hasId } from "../../lib/dom.tsx";
import { LiquidPopoverSurface } from "../gooey/LiquidPopoverSurface/index.tsx";
import { IconChevronDown } from "../Icons/index.tsx";
import { DropdownOptions } from "./DropdownOptions.tsx";
import { DropdownSearch } from "./DropdownSearch.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
import { useDropdownPosition } from "./useDropdownPosition.ts";

interface DropdownButtonProps {
	value: string | null;
	options: readonly DropdownOption[];
	onChange: (id: string) => void;
	placeholder?: string;
	icon?: Element;
	emptyLabel?: string;
	minWidth?: number;
	fullWidth?: boolean;
	renderOption?: DropdownOptionRenderer;
	buttonClassName?: string;
	labelClassName?: string;
	menuPlacement?: "auto" | "top" | "bottom";
	maxVisibleOptions?: number;
	optionHeight?: number;
	onOpen?: () => void;
	/** Visual-only liquid treatment for the trigger. */
	liquid?: boolean;
}
export function DropdownButton(_props: DropdownButtonProps) {
	const [open, setOpen] = createSignal(false);
	const [menuPresent, setMenuPresent] = createSignal(false);
	const [search, setSearch] = createSignal("");
	const [trigger, setTrigger] = createSignal<HTMLButtonElement | null>(null);
	const menuRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const searchRef = {
		current: null,
	} as {
		current: HTMLInputElement | null;
	};
	const pos = useDropdownPosition(() =>
		open()
			? {
					element: trigger(),
					liquid: _props.liquid ?? true,
					placement: _props.menuPlacement ?? "auto",
					rowHeight: _props.optionHeight ?? (_props.renderOption ? 34 : 30),
					count: _props.options.length,
					maxVisible: _props.maxVisibleOptions,
					minWidth: _props.minWidth ?? 220,
				}
			: null,
	);
	createEffect(
		() => [menuPresent(), open()] as const,
		([present, isOpen]) => {
			if (isOpen) {
				setMenuPresent(true);
				return;
			}
			if (!present) return;
			const timeout = window.setTimeout(() => setMenuPresent(false), 220);
			return () => window.clearTimeout(timeout);
		},
	);
	createEffect(open, (isOpen) => {
		if (!isOpen) return;
		const handleDocumentPointerDown = (event: MouseEvent) => {
			if (
				menuRef.current &&
				!menuRef.current.contains(event.target as Node) &&
				!trigger()?.contains(event.target as Node)
			)
				setOpen(false);
		};
		const handleWindowScroll = (event: Event) => {
			if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const handleDocumentKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", handleDocumentPointerDown);
		window.addEventListener("scroll", handleWindowScroll, true);
		document.addEventListener("keydown", handleDocumentKeyDown);
		return () => {
			document.removeEventListener("mousedown", handleDocumentPointerDown);
			window.removeEventListener("scroll", handleWindowScroll, true);
			document.removeEventListener("keydown", handleDocumentKeyDown);
		};
	});

	const toggle = () => {
		const _openValue = open();
		if (!_openValue) {
			_props.onOpen?.();
			setSearch("");
		}
		setOpen(!_openValue);
	};
	const selected = createMemo(() =>
		_props.options.find(hasId.bind(null, _props.value)),
	);
	const buttonProps = createMemo(() =>
		stylex.attrs(
			styles.button,
			(_props.fullWidth === undefined ? false : _props.fullWidth)
				? styles.fullWidth
				: null,
			open() ? styles.buttonOpen : styles.buttonClosed,
		),
	);
	const showSearch = createMemo(() => _props.options.length > 5);
	createEffect(
		() => open() && menuPresent() && showSearch(),
		(focus) => {
			if (!focus) return;
			const timer = setTimeout(() => searchRef.current?.focus(), 0);
			return () => clearTimeout(timer);
		},
	);
	const filtered = createMemo(() => {
		const _searchValue = search();
		if (!_searchValue) return _props.options;
		const needle = _searchValue.toLowerCase();
		return _props.options.filter(
			(o) =>
				o.label.toLowerCase().includes(needle) ||
				o.detail?.toLowerCase().includes(needle) ||
				o.status?.toLowerCase().includes(needle),
		);
	});
	const SearchBox = () => (
		<Show when={showSearch()}>
			<DropdownSearch
				searchRef={searchRef}
				search={search()}
				setSearch={setSearch}
				setOpen={setOpen}
			/>
		</Show>
	);
	const OptionsBox = () => (
		<DropdownOptions
			maxHeight={Math.max(44, pos().maxH - (showSearch() ? 38 : 0))}
			filtered={filtered()}
			search={search()}
			emptyLabel={_props.emptyLabel ?? "No options"}
			renderOption={_props.renderOption}
			value={_props.value}
			onChange={_props.onChange}
			setOpen={setOpen}
		/>
	);
	const Trigger = () => (
		<button
			type="button"
			ref={setTrigger}
			onClick={toggle}
			{...buttonProps()}
			class={`${buttonProps().class ?? ""} ${_props.buttonClassName ?? ""}`}
		>
			{_props.icon}
			<span
				class={`${stylex.attrs(styles.buttonLabel, _props.fullWidth && styles.buttonLabelFull, selected() ? styles.buttonLabelSelected : styles.buttonLabelMuted).class ?? ""} ${_props.labelClassName ?? ""}`}
			>
				{selected()?.label || _props.placeholder || "Select..."}
			</span>
			<IconChevronDown
				size={iconSize.sm}
				class={stylex.attrs(styles.chevron, open() && styles.chevronOpen).class}
			/>
		</button>
	);
	const onTop = createMemo(() => pos().placement === "top");
	const liquid = createMemo(() => _props.liquid ?? true);
	const Menu = () => (
		<div
			ref={(element) => (menuRef.current = element)}
			class={`${stylex.attrs(styles.menu, liquid() && styles.menuLiquid).class ?? ""} ${liquid() ? `inferay-liquid-popover-panel inferay-liquid-popover-panel--${pos().placement} ${open() ? "inferay-liquid-popover-panel--open" : "inferay-liquid-popover-panel--closing"}` : ""}`}
			style={domStyle(
				inlineStyles.getDropdownButtonMenuStyle(
					onTop() ? undefined : pos().top,
					onTop() ? pos().bottom : undefined,
					pos().left,
					pos().width,
					pos().maxH,
				),
			)}
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
	return (
		<Show
			when={liquid()}
			fallback={
				<>
					<Trigger />
					<Show when={menuPresent()}>
						<Portal mount={document.body}>
							<Menu />
						</Portal>
					</Show>
				</>
			}
		>
			<LiquidPopoverSurface
				open={open()}
				present={menuPresent()}
				trigger={<Trigger />}
				panel={<Menu />}
				portalTarget={document.body}
				fill={runtimeColor.backgroundRaised}
				fullWidth={_props.fullWidth ?? false}
			/>
		</Show>
	);
}

export interface DropdownOption {
	iconComponent?: import("solid-js").Component;
	id: string;
	label: string;
	detail?: string;
	status?: string;
	icon?: Element;
}
export type DropdownOptionRenderer = (props: {
	option: DropdownOption;
	isSelected: boolean;
}) => Element;
