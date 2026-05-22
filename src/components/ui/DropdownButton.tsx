import * as stylex from "@stylexjs/stylex";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hasId } from "../../lib/data.ts";
import {
	activateOnEnterOrSpacePreventDefault,
	setInputValue,
} from "../../lib/react-events.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
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
			const rowHeight = 32;
			const searchHeight = options.length > 5 ? 42 : 0;
			const contentHeight = Math.min(
				options.length * rowHeight + searchHeight,
				400
			);
			const maxH = Math.min(
				contentHeight,
				placeAbove ? spaceAbove : spaceBelow,
				400
			);
			setPos({
				top: placeAbove ? Math.max(8, rect.top - maxH - 4) : rect.bottom + 4,
				left: rect.left,
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
			style={{ maxHeight: pos.maxH - (showSearch ? 42 : 2) }}
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
								<span className="shrink-0 text-inferay-muted-gray">
									{opt.icon}
								</span>
							)}
							<div>
								<span className="font-medium">{opt.label}</span>
								{opt.detail && (
									<span
										className={`ml-2 rounded-md px-1.5 py-0.5 text-[9px] font-medium ${
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
									<span className="ml-2 text-[10px] text-inferay-muted-gray">
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
						? `flex items-center text-xs transition-colors ${fullWidth ? "w-full" : ""} ${buttonClassName}`
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
							top: pos.top,
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
		borderWidth: 1,
		display: "flex",
		fontSize: font.size_3,
		gap: controlSize._2,
		height: controlSize._7,
		paddingInline: controlSize._3,
		transitionDuration: "150ms",
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: "ease",
		userSelect: "none",
	},
	buttonClosed: {
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		borderColor: color.border,
		color: color.textSoft,
	},
	buttonOpen: {
		backgroundColor: color.controlActive,
		borderColor: "rgba(229, 229, 231, 0.4)",
		color: color.textMain,
	},
	fullWidth: {
		width: "100%",
	},
	menu: {
		backdropFilter: "blur(24px)",
		backgroundColor: "rgba(28, 28, 30, 0.95)",
		borderColor: color.border,
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.75)",
		overflow: "hidden",
		position: "fixed",
		userSelect: "none",
		zIndex: 50,
	},
	searchWrap: {
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		paddingBlock: "0.375rem",
		paddingInline: controlSize._2,
	},
	searchInput: {
		backgroundColor: "rgba(28, 28, 30, 0.5)",
		borderColor: "rgba(255, 255, 255, 0.04)",
		borderRadius: 6,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMain,
		fontSize: font.size_3,
		outline: "none",
		paddingBlock: "0.375rem",
		paddingInline: "0.625rem",
		width: "100%",
		userSelect: "text",
		"::placeholder": {
			color: color.textMuted,
		},
		":focus": {
			borderColor: color.border,
		},
	},
	optionsBox: {
		overflowY: "auto",
	},
	empty: {
		color: color.textMuted,
		fontSize: font.size_3,
		paddingBlock: controlSize._4,
		paddingInline: controlSize._3,
		textAlign: "center",
	},
	option: {
		alignItems: "center",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		display: "flex",
		fontSize: font.size_3,
		gap: controlSize._2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		transitionDuration: "150ms",
		transitionProperty: "background-color, color",
		transitionTimingFunction: "ease",
		userSelect: "none",
		width: "100%",
	},
	optionSelected: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
});
