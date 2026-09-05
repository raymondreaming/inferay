import * as stylex from "@octanejs/stylex";
import {
	createPortal,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "octane";
import {
	iconSize,
	runtimeColor,
} from "../../../design-system/styles.stylex.ts";
import {
	type DropdownOption,
	type DropdownOptionRenderer,
	hasId,
	selectDropdownOption,
	setInputValue,
} from "../../lib/data.ts";
import { LiquidPopoverSurface } from "../gooey/LiquidPopoverSurface/index.tsx";
import { IconChevronDown } from "../Icons/index.tsx";
import { DropdownCustomOption } from "./DropdownCustomOption.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

interface DropdownButtonProps {
	value: string | null;
	options: DropdownOption[];
	onChange: (id: string) => void;
	placeholder?: string;
	icon?: unknown;
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
	liquid = true,
}: DropdownButtonProps) {
	const [open, setOpen] = useState(false);
	const [menuPresent, setMenuPresent] = useState(false);
	const [search, setSearch] = useState("");
	const btnRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const searchRef = useRef<HTMLInputElement | null>(null);
	const [pos, setPos] = useState({
		top: 0,
		bottom: 0,
		left: 0,
		width: 0,
		maxH: 300,
		placement: "bottom" as "top" | "bottom",
	});
	useEffect(() => {
		if (open) {
			setMenuPresent(true);
			return;
		}
		if (!menuPresent) return;
		const timeout = window.setTimeout(() => setMenuPresent(false), 220);
		return () => window.clearTimeout(timeout);
	}, [menuPresent, open]);
	useEffect(() => {
		if (!open) return;
		const handleDocumentPointerDown = (event: MouseEvent) => {
			if (
				menuRef.current &&
				!menuRef.current.contains(event.target as Node) &&
				!btnRef.current?.contains(event.target as Node)
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
	}, [open]);
	const updateMenuPosition = useCallback(() => {
		if (!btnRef.current) return;
		const rect = btnRef.current.getBoundingClientRect();
		const menuGap = liquid ? 12 : 4;
		const spaceBelow = window.innerHeight - rect.bottom - menuGap;
		const spaceAbove = rect.top - menuGap;
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
			400,
		);
		const maxH = Math.min(contentHeight, placeAbove ? spaceAbove : spaceBelow);
		setPos({
			top: placeAbove ? 0 : rect.bottom + menuGap,
			bottom: placeAbove ? window.innerHeight - rect.top + menuGap : 0,
			left: Math.min(
				Math.max(8, rect.left),
				Math.max(8, window.innerWidth - Math.max(rect.width, minWidth) - 8),
			),
			width: Math.max(rect.width, minWidth),
			maxH,
			placement: placeAbove ? "top" : "bottom",
		});
	}, [
		maxVisibleOptions,
		menuPlacement,
		minWidth,
		liquid,
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
		[options, value],
	);
	const buttonProps = stylex.props(
		styles.button,
		fullWidth ? styles.fullWidth : null,
		open ? styles.buttonOpen : styles.buttonClosed,
	);
	const showSearch = options.length > 5;
	const filtered = useMemo(() => {
		if (!search) return options;
		const needle = search.toLowerCase();
		return options.filter(
			(o) =>
				o.label.toLowerCase().includes(needle) ||
				o.detail?.toLowerCase().includes(needle) ||
				o.status?.toLowerCase().includes(needle),
		);
	}, [options, search]);
	const searchBox = showSearch ? (
		<div {...stylex.props(styles.searchWrap)}>
			<input
				ref={searchRef}
				type="text"
				value={search}
				onInput={setInputValue.bind(null, setSearch)}
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
			style={inlineStyles.getDropdownButtonOptionsBoxStyle(
				Math.max(44, pos.maxH - (showSearch ? 38 : 0)),
			)}
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
								opt.id,
							)}
							{...stylex.props(
								styles.option,
								opt.id === value ? styles.optionSelected : null,
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
												styles.detailBadgeFeatured,
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
					),
				)
			)}
		</div>
	);
	const trigger = (
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
					selected ? styles.buttonLabelSelected : styles.buttonLabelMuted,
				)}
				className={`${
					stylex.props(
						styles.buttonLabel,
						fullWidth && styles.buttonLabelFull,
						selected ? styles.buttonLabelSelected : styles.buttonLabelMuted,
					).className ?? ""
				} ${labelClassName}`}
			>
				{selected?.label || placeholder}
			</span>
			<IconChevronDown
				size={iconSize.sm}
				className={
					stylex.props(styles.chevron, open && styles.chevronOpen).className
				}
			/>
		</button>
	);
	const menu = (
		<div
			ref={menuRef}
			{...stylex.props(styles.menu, liquid && styles.menuLiquid)}
			className={`${stylex.props(styles.menu, liquid && styles.menuLiquid).className ?? ""} ${
				liquid
					? `inferay-liquid-popover-panel inferay-liquid-popover-panel--${pos.placement} ${open ? "inferay-liquid-popover-panel--open" : "inferay-liquid-popover-panel--closing"}`
					: ""
			}`}
			style={inlineStyles.getDropdownButtonMenuStyle(
				pos.placement === "bottom" ? pos.top : undefined,
				pos.placement === "top" ? pos.bottom : undefined,
				pos.left,
				pos.width,
				pos.maxH,
			)}
		>
			{pos.placement === "top" ? (
				<>
					{optionsBox}
					{searchBox && (
						<div {...stylex.props(styles.topSearchDivider)}>{searchBox}</div>
					)}
				</>
			) : (
				<>
					{searchBox}
					{optionsBox}
				</>
			)}
		</div>
	);
	return (
		<>
			{liquid ? (
				<LiquidPopoverSurface
					open={open}
					present={menuPresent}
					trigger={trigger}
					panel={menu}
					portalTarget={document.body}
					fill={runtimeColor.backgroundRaised}
					fullWidth={fullWidth}
				/>
			) : (
				<>
					{trigger}
					{menuPresent && createPortal(menu, document.body)}
				</>
			)}
		</>
	);
}

export type { DropdownOption } from "../../lib/data.ts";
