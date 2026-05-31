import * as stylex from "@stylexjs/stylex";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hasId } from "../../lib/data.ts";
import {
	activateOnEnterOrSpacePreventDefault,
	setInputValue,
} from "../../lib/react-events.ts";
import {
	color,
	controlSize,
	effect,
	font,
	shadow,
} from "../../tokens.stylex.ts";
import { IconChevronDown } from "./Icons.tsx";

interface DropdownOption {
	id: string;
	label: string;
	detail?: string;
	status?: string;
	icon?: React.ReactNode;
}

interface DropdownButtonProps {
	value: string | null;
	options: DropdownOption[];
	onChange: (id: string) => void;
	placeholder?: string;
	icon?: React.ReactNode;
	emptyLabel?: string;
	minWidth?: number;
	fullWidth?: boolean;
	renderOption?: (opt: DropdownOption, isSelected: boolean) => React.ReactNode;
	buttonClassName?: string;
	labelClassName?: string;
	menuPlacement?: "auto" | "top" | "bottom";
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
	renderOption: (opt: DropdownOption, isSelected: boolean) => React.ReactNode;
	onChange: (id: string) => void;
	setOpen: (v: boolean) => void;
}) {
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={selectDropdownOption.bind(null, onChange, setOpen, opt.id)}
			onKeyDown={activateOnEnterOrSpacePreventDefault.bind(
				null,
				selectDropdownOption.bind(null, onChange, setOpen, opt.id)
			)}
			className="cursor-pointer"
		>
			{renderOption(opt, isSelected)}
		</div>
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
}: DropdownButtonProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const btnRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const [pos, setPos] = useState({
		top: 0,
		bottom: 0,
		left: 0,
		width: 0,
		maxH: 300,
		placement: "bottom" as "top" | "bottom",
	});
	useEffect(() => {
		if (!open) return;
		const handleClick = (e: MouseEvent) => {
			if (
				menuRef.current &&
				!menuRef.current.contains(e.target as Node) &&
				!btnRef.current?.contains(e.target as Node)
			) {
				setOpen(false);
			}
		};
		const handleScroll = (e: Event) => {
			if (menuRef.current?.contains(e.target as Node)) return;
			setOpen(false);
		};
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", handleClick);
		window.addEventListener("scroll", handleScroll, true);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			window.removeEventListener("scroll", handleScroll, true);
			document.removeEventListener("keydown", handleKey);
		};
	}, [open]);
	const toggle = () => {
		if (!open && btnRef.current) {
			const rect = btnRef.current.getBoundingClientRect();
			const spaceBelow = window.innerHeight - rect.bottom - 8;
			const spaceAbove = rect.top - 8;
			const placeAbove =
				menuPlacement === "top" ||
				(menuPlacement === "auto" && spaceAbove > spaceBelow);
			const rowHeight = renderOption ? 34 : 30;
			const searchHeight = options.length > 5 ? 38 : 0;
			const contentHeight = Math.min(
				options.length * rowHeight + searchHeight + 2,
				400
			);
			const maxH = Math.min(
				contentHeight,
				placeAbove ? spaceAbove : spaceBelow
			);
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
			setSearch("");
			setTimeout(() => searchRef.current?.focus(), 0);
		}
		setOpen(!open);
	};
	const selected = options.find(hasId.bind(null, value));
	const buttonProps = stylex.props(
		styles.button,
		fullWidth ? styles.fullWidth : null,
		open ? styles.buttonOpen : styles.buttonClosed
	);
	const showSearch = options.length > 5;
	const filtered = search
		? options.filter(
				(o) =>
					o.label.toLowerCase().includes(search.toLowerCase()) ||
					o.detail?.toLowerCase().includes(search.toLowerCase()) ||
					o.status?.toLowerCase().includes(search.toLowerCase())
			)
		: options;
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
								<span className="shrink-0 text-inferay-muted-gray [&_svg]:h-3 [&_svg]:w-3">
									{opt.icon}
								</span>
							)}
							<div className="min-w-0">
								<span className="block truncate font-medium">{opt.label}</span>
								{opt.detail && (
									<span
										className={`ml-1.5 rounded px-1 py-0.5 text-[8px] font-medium ${
											opt.detail.includes("★")
												? "bg-inferay-white/[0.08] text-inferay-soft-white"
												: opt.detail.includes("Best")
													? "bg-inferay-white/[0.08] text-inferay-soft-white"
													: "bg-inferay-white/[0.06] text-inferay-muted-gray"
										}`}
									>
										{opt.detail}
									</span>
								)}
								{opt.status && (
									<span className="ml-1.5 text-[9px] text-inferay-muted-gray">
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
						? `${buttonProps.className ?? ""} flex items-center text-xs transition-colors ${fullWidth ? "w-full" : ""} ${buttonClassName}`
						: buttonProps.className
				}
			>
				{icon}
				<span
					className={`${fullWidth ? "flex-1 truncate text-left" : ""} ${selected ? "text-inferay-white" : "text-inferay-muted-gray"} ${labelClassName}`}
				>
					{selected?.label || placeholder}
				</span>
				<IconChevronDown
					size={10}
					className={`shrink-0 text-inferay-muted-gray transition-transform ${open ? "rotate-180" : ""}`}
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
									<div className="border-t border-inferay-gray-border">
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
		zIndex: 120,
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
	optionSelected: {
		backgroundColor: color.controlActive,
		backgroundImage:
			"linear-gradient(90deg, rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.018))",
		color: color.textMain,
	},
});
