import * as stylex from "@stylexjs/stylex";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hasId } from "../../lib/data.ts";
import { setInputValue } from "../../lib/react-events.ts";
import {
	color,
	controlSize,
	effect,
	font,
	shadow,
} from "../../tokens.stylex.ts";
import { IconChevronDown } from "./Icons.tsx";

export interface DropdownOption {
	id: string;
	label: string;
	detail?: string;
	status?: string;
	icon?: React.ReactNode;
}

type DropdownOptionRenderer =
	| React.ComponentType<{
			option: DropdownOption;
			isSelected: boolean;
	  }>
	| ((option: DropdownOption, isSelected: boolean) => React.ReactNode);

interface DropdownButtonProps {
	value: string | null;
	options: DropdownOption[];
	onChange: (id: string) => void;
	placeholder?: string;
	icon?: React.ReactNode;
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
}

function selectDropdownOption(
	onChange: (id: string) => void,
	setOpen: (v: boolean) => void,
	id: string
) {
	onChange(id);
	setOpen(false);
}

function DropdownCustomOption({
	opt,
	isSelected,
	renderOption,
	onChange,
	setOpen,
}: {
	opt: DropdownOption;
	isSelected: boolean;
	renderOption: DropdownOptionRenderer;
	onChange: (id: string) => void;
	setOpen: (v: boolean) => void;
}) {
	const OptionContent = renderOption as React.ComponentType<{
		option: DropdownOption;
		isSelected: boolean;
	}>;
	const content =
		renderOption.length >= 2 ? (
			Reflect.apply(renderOption, undefined, [opt, isSelected])
		) : (
			<OptionContent option={opt} isSelected={isSelected} />
		);
	return (
		<button
			type="button"
			onClick={selectDropdownOption.bind(null, onChange, setOpen, opt.id)}
			{...stylex.props(styles.customOption)}
		>
			{content}
		</button>
	);
}

export function DropdownButton({
	value,
	options,
	onChange,
	placeholder = "Select...",
	icon,
	emptyLabel = "No options",
	minWidth = 220,
	fullWidth = false,
	renderOption,
	buttonClassName,
	labelClassName = "",
	menuPlacement = "auto",
	maxVisibleOptions,
	optionHeight,
	onOpen,
}: DropdownButtonProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const btnRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const eventHandlersRef = useRef({
		handleDocumentPointerDown: (_event: MouseEvent) => {},
		handleWindowScroll: (_event: Event) => {},
		handleDocumentKeyDown: (_event: KeyboardEvent) => {},
	});
	const [pos, setPos] = useState({
		top: 0,
		bottom: 0,
		left: 0,
		width: 0,
		maxH: 300,
		placement: "bottom" as "top" | "bottom",
	});
	eventHandlersRef.current = {
		handleDocumentPointerDown(event) {
			if (
				menuRef.current &&
				!menuRef.current.contains(event.target as Node) &&
				!btnRef.current?.contains(event.target as Node)
			) {
				setOpen(false);
			}
		},
		handleWindowScroll(event) {
			if (menuRef.current?.contains(event.target as Node)) return;
			setOpen(false);
		},
		handleDocumentKeyDown(event) {
			if (event.key === "Escape") setOpen(false);
		},
	};
	useEffect(() => {
		if (!open) return;
		const handleDocumentPointerDown = (event: MouseEvent) =>
			eventHandlersRef.current.handleDocumentPointerDown(event);
		const handleWindowScroll = (event: Event) =>
			eventHandlersRef.current.handleWindowScroll(event);
		const handleDocumentKeyDown = (event: KeyboardEvent) =>
			eventHandlersRef.current.handleDocumentKeyDown(event);
		document.addEventListener("mousedown", handleDocumentPointerDown);
		window.addEventListener("scroll", handleWindowScroll, true);
		document.addEventListener("keydown", handleDocumentKeyDown);
		return () => {
			document.removeEventListener("mousedown", handleDocumentPointerDown);
			window.removeEventListener("scroll", handleWindowScroll, true);
			document.removeEventListener("keydown", handleDocumentKeyDown);
		};
	}, [open]);
	const updateMenuPosition = useCallback(() => {
		if (!btnRef.current) return;
		const rect = btnRef.current.getBoundingClientRect();
		const spaceBelow = window.innerHeight - rect.bottom - 8;
		const spaceAbove = rect.top - 8;
		const placeAbove =
			menuPlacement === "top" ||
			(menuPlacement === "auto" && spaceAbove > spaceBelow);
		const rowHeight = optionHeight ?? (renderOption ? 34 : 30);
		const searchHeight = options.length > 5 ? 38 : 0;
		const visibleOptionCount = maxVisibleOptions
			? Math.min(options.length, maxVisibleOptions)
			: options.length;
		const contentHeight = Math.min(
			visibleOptionCount * rowHeight + searchHeight + 2,
			400
		);
		const maxH = Math.min(contentHeight, placeAbove ? spaceAbove : spaceBelow);
		setPos({
			top: placeAbove ? 0 : rect.bottom + 4,
			bottom: placeAbove ? window.innerHeight - rect.top + 4 : 0,
			left: Math.min(
				Math.max(8, rect.left),
				Math.max(8, window.innerWidth - Math.max(rect.width, minWidth) - 8)
			),
			width: Math.max(rect.width, minWidth),
			maxH,
			placement: placeAbove ? "top" : "bottom",
		});
	}, [
		maxVisibleOptions,
		menuPlacement,
		minWidth,
		optionHeight,
		options.length,
		renderOption,
	]);
	const toggle = () => {
		if (!open) {
			onOpen?.();
			updateMenuPosition();
			setSearch("");
			setTimeout(() => searchRef.current?.focus(), 0);
		}
		setOpen(!open);
	};
	const selected = useMemo(
		() => options.find(hasId.bind(null, value)),
		[options, value]
	);
	const buttonProps = stylex.props(
		styles.button,
		fullWidth ? styles.fullWidth : null,
		open ? styles.buttonOpen : styles.buttonClosed
	);
	const showSearch = options.length > 5;
	const filtered = useMemo(() => {
		if (!search) return options;
		const needle = search.toLowerCase();
		return options.filter(
			(o) =>
				o.label.toLowerCase().includes(needle) ||
				o.detail?.toLowerCase().includes(needle) ||
				o.status?.toLowerCase().includes(needle)
		);
	}, [options, search]);
	const searchBox = showSearch ? (
		<div {...stylex.props(styles.searchWrap)}>
			<input
				ref={searchRef}
				type="text"
				value={search}
				onChange={setInputValue.bind(null, setSearch)}
				placeholder="Search..."
				{...stylex.props(styles.searchInput)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						setOpen(false);
					}
				}}
			/>
		</div>
	) : null;
	const optionsBox = (
		<div
			{...stylex.props(styles.optionsBox)}
			style={{ maxHeight: Math.max(44, pos.maxH - (showSearch ? 38 : 0)) }}
		>
			{filtered.length === 0 ? (
				<p {...stylex.props(styles.empty)}>
					{search ? "No matches" : emptyLabel}
				</p>
			) : (
				filtered.map((opt) =>
					renderOption ? (
						<DropdownCustomOption
							key={opt.id}
							opt={opt}
							isSelected={opt.id === value}
							renderOption={renderOption}
							onChange={onChange}
							setOpen={setOpen}
						/>
					) : (
						<button
							type="button"
							key={opt.id}
							onClick={selectDropdownOption.bind(
								null,
								onChange,
								setOpen,
								opt.id
							)}
							{...stylex.props(
								styles.option,
								opt.id === value ? styles.optionSelected : null
							)}
						>
							{opt.icon && (
								<span {...stylex.props(styles.optionIcon)}>{opt.icon}</span>
							)}
							<div {...stylex.props(styles.optionContent)}>
								<span {...stylex.props(styles.optionLabel)}>{opt.label}</span>
								{opt.detail && (
									<span
										{...stylex.props(
											styles.detailBadge,
											(opt.detail.includes("★") ||
												opt.detail.includes("Best")) &&
												styles.detailBadgeFeatured
										)}
									>
										{opt.detail}
									</span>
								)}
								{opt.status && (
									<span {...stylex.props(styles.optionStatus)}>
										{opt.status}
									</span>
								)}
							</div>
						</button>
					)
				)
			)}
		</div>
	);
	return (
		<>
			<button
				type="button"
				ref={btnRef}
				onClick={toggle}
				{...(buttonClassName ? {} : buttonProps)}
				className={
					buttonClassName
						? `${buttonProps.className ?? ""} ${buttonClassName}`
						: buttonProps.className
				}
			>
				{icon}
				<span
					{...stylex.props(
						styles.buttonLabel,
						fullWidth && styles.buttonLabelFull,
						selected ? styles.buttonLabelSelected : styles.buttonLabelMuted
					)}
					className={`${
						stylex.props(
							styles.buttonLabel,
							fullWidth && styles.buttonLabelFull,
							selected ? styles.buttonLabelSelected : styles.buttonLabelMuted
						).className ?? ""
					} ${labelClassName}`}
				>
					{selected?.label || placeholder}
				</span>
				<IconChevronDown
					size={10}
					className={
						stylex.props(styles.chevron, open && styles.chevronOpen).className
					}
				/>
			</button>
			{open &&
				createPortal(
					<div
						ref={menuRef}
						{...stylex.props(styles.menu)}
						style={{
							top: pos.placement === "bottom" ? pos.top : undefined,
							bottom: pos.placement === "top" ? pos.bottom : undefined,
							left: pos.left,
							minWidth: pos.width,
							maxHeight: pos.maxH,
						}}
					>
						{pos.placement === "top" ? (
							<>
								{optionsBox}
								{searchBox && (
									<div {...stylex.props(styles.topSearchDivider)}>
										{searchBox}
									</div>
								)}
							</>
						) : (
							<>
								{searchBox}
								{optionsBox}
							</>
						)}
					</div>,
					document.body
				)}
		</>
	);
}

const styles = stylex.create({
	button: {
		alignItems: "center",
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: "var(--dropdown-button-border-width, 1px)",
		display: "flex",
		fontSize: font.size_3,
		gap: controlSize._2,
		height: controlSize._7,
		paddingInline: controlSize._3,
		boxShadow: `var(--dropdown-button-shadow, ${shadow.controlDepth})`,
		transitionDuration: "150ms",
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color",
		transitionTimingFunction: "ease",
		userSelect: "none",
	},
	buttonLabel: {
		fontSize: font.size_2,
		transitionProperty: "color",
		transitionDuration: "150ms",
	},
	buttonLabelFull: {
		flex: 1,
		overflow: "hidden",
		textAlign: "left",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	buttonLabelSelected: {
		color: color.textMain,
	},
	buttonLabelMuted: {
		color: color.textMuted,
	},
	chevron: {
		color: color.textMuted,
		flexShrink: 0,
		transitionDuration: "150ms",
		transitionProperty: "transform",
		transitionTimingFunction: "ease",
	},
	chevronOpen: {
		transform: "rotate(180deg)",
	},
	buttonClosed: {
		backgroundColor: {
			default: `var(--dropdown-button-bg-color, ${color.backgroundRaised})`,
			":hover": `var(--dropdown-button-hover-bg-color, var(--dropdown-button-bg-color, ${color.controlHover}))`,
		},
		backgroundImage: {
			default: `var(--dropdown-button-bg-image, ${effect.controlDepth})`,
			":hover": `var(--dropdown-button-hover-bg-image, var(--dropdown-button-bg-image, ${effect.controlDepthHover}))`,
		},
		borderColor: `var(--dropdown-button-border-color, ${color.border})`,
		color: `var(--dropdown-button-color, ${color.textSoft})`,
		boxShadow: {
			default: `var(--dropdown-button-shadow, ${shadow.controlDepth})`,
			":hover": `var(--dropdown-button-hover-shadow, var(--dropdown-button-shadow, ${shadow.controlDepthHover}))`,
		},
	},
	buttonOpen: {
		backgroundColor: `var(--dropdown-button-open-bg-color, var(--dropdown-button-bg-color, ${color.controlActive}))`,
		backgroundImage: `var(--dropdown-button-open-bg-image, var(--dropdown-button-bg-image, ${effect.controlDepthHover}))`,
		borderColor: `var(--dropdown-button-open-border-color, var(--dropdown-button-border-color, ${color.borderStrong}))`,
		boxShadow: `var(--dropdown-button-open-shadow, var(--dropdown-button-shadow, ${shadow.controlDepthHover}))`,
		color: `var(--dropdown-button-open-color, var(--dropdown-button-color, ${color.textMain}))`,
	},
	fullWidth: {
		width: "100%",
	},
	menu: {
		backdropFilter: "blur(24px)",
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.popoverDepth,
		borderColor: color.border,
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.popover,
		overflow: "hidden",
		position: "fixed",
		userSelect: "none",
		zIndex: 320,
	},
	searchWrap: {
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	searchInput: {
		backgroundColor: color.surfaceControl,
		backgroundImage: effect.controlDepth,
		borderColor: color.border,
		borderRadius: 6,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMain,
		fontSize: font.size_2,
		outline: "none",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		width: "100%",
		userSelect: "text",
		"::placeholder": {
			color: color.textMuted,
		},
		":focus": {
			borderColor: color.accentBorder,
			boxShadow: shadow.focusRing,
		},
	},
	optionsBox: {
		overflowY: "auto",
		scrollbarWidth: "none",
		"::-webkit-scrollbar": {
			display: "none",
		},
	},
	empty: {
		color: color.textMuted,
		fontSize: font.size_2,
		paddingBlock: controlSize._3,
		paddingInline: controlSize._3,
		textAlign: "center",
	},
	customOption: {
		cursor: "pointer",
		display: "block",
		width: "100%",
	},
	option: {
		alignItems: "center",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		display: "flex",
		fontSize: font.size_2,
		gap: controlSize._2,
		minHeight: 26,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: "150ms",
		transitionProperty: "background-color, color",
		transitionTimingFunction: "ease",
		userSelect: "none",
		width: "100%",
	},
	optionIcon: {
		color: color.textMuted,
		flexShrink: 0,
	},
	optionContent: {
		minWidth: 0,
	},
	optionLabel: {
		display: "block",
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	detailBadge: {
		backgroundColor: "rgba(255, 255, 255, 0.06)",
		borderRadius: 4,
		color: color.textMuted,
		fontSize: "0.5rem",
		fontWeight: font.weight_5,
		marginLeft: controlSize._1_5,
		paddingBlock: "0.125rem",
		paddingInline: controlSize._1,
	},
	detailBadgeFeatured: {
		backgroundColor: "rgba(255, 255, 255, 0.08)",
		color: color.textSoft,
	},
	optionStatus: {
		color: color.textMuted,
		fontSize: "0.5625rem",
		marginLeft: controlSize._1_5,
	},
	optionSelected: {
		backgroundColor: color.controlActive,
		backgroundImage:
			"linear-gradient(90deg, rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.018))",
		color: color.textMain,
	},
	topSearchDivider: {
		borderTopColor: color.border,
		borderTopStyle: "solid",
		borderTopWidth: 1,
	},
});
