import * as stylex from "@octanejs/stylex";
import { useEffect, useMemo, useRef, useState } from "octane";
import {
	color,
	controlSize,
	font,
	layer,
	radius,
	shadow,
} from "../../design-system/styles.stylex.ts";
import { IconSearch } from "../../shared/ui/Icons.tsx";
import { APP_REGION_NO_DRAG_CLASS } from "../model/appearance.ts";

export interface CommandPaletteItem {
	id: string;
	label: string;
	detail: string;
	icon: unknown;
	keywords?: string;
	run: () => void;
}

export function CommandPalette({
	commands,
	showTrigger = true,
}: {
	commands: readonly CommandPaletteItem[];
	showTrigger?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const filteredCommands = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		if (!needle) return commands;
		return commands.filter((command) =>
			`${command.label} ${command.detail} ${command.keywords ?? ""}`
				.toLocaleLowerCase()
				.includes(needle),
		);
	}, [commands, query]);

	useEffect(() => {
		const handleShortcut = (event: KeyboardEvent) => {
			if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLocaleLowerCase() === "k"
			) {
				event.preventDefault();
				setOpen((current) => !current);
			}
		};
		window.addEventListener("keydown", handleShortcut);
		return () => window.removeEventListener("keydown", handleShortcut);
	}, []);

	useEffect(() => {
		if (!open) {
			setQuery("");
			setActiveIndex(0);
			return;
		}
		requestAnimationFrame(() => inputRef.current?.focus());
	}, [open]);

	useEffect(() => setActiveIndex(0), [query]);

	const execute = (command: CommandPaletteItem | undefined) => {
		if (!command) return;
		setOpen(false);
		command.run();
	};

	return (
		<>
			{showTrigger ? (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.trigger).className ?? ""}`}
					aria-label="Open command palette"
					title="Open command palette (⌘K)"
				>
					<IconSearch size={14} />
					<span {...stylex.props(styles.triggerLabel)}>Command</span>
					<kbd {...stylex.props(styles.shortcut)}>⌘K</kbd>
				</button>
			) : null}
			{open ? (
				<div
					role="presentation"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setOpen(false);
					}}
					{...stylex.props(styles.backdrop)}
				>
					<section
						role="dialog"
						aria-modal="true"
						aria-label="Command palette"
						{...stylex.props(styles.palette)}
						className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.palette).className ?? ""}`}
					>
						<label {...stylex.props(styles.search)}>
							<IconSearch size={16} />
							<input
								ref={inputRef}
								value={query}
								onInput={(event) => setQuery(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										setOpen(false);
									} else if (event.key === "ArrowDown") {
										event.preventDefault();
										setActiveIndex((current) =>
											Math.min(filteredCommands.length - 1, current + 1),
										);
									} else if (event.key === "ArrowUp") {
										event.preventDefault();
										setActiveIndex((current) => Math.max(0, current - 1));
									} else if (event.key === "Enter") {
										event.preventDefault();
										execute(filteredCommands[activeIndex]);
									}
								}}
								placeholder="What do you want to do?"
								aria-label="Search commands"
								{...stylex.props(styles.input)}
							/>
							<kbd {...stylex.props(styles.escape)}>esc</kbd>
						</label>
						<div role="listbox" {...stylex.props(styles.results)}>
							{filteredCommands.length ? (
								filteredCommands.map((command, index) => (
									<button
										key={command.id}
										type="button"
										role="option"
										aria-selected={index === activeIndex}
										onMouseEnter={() => setActiveIndex(index)}
										onClick={() => execute(command)}
										{...stylex.props(
											styles.command,
											index === activeIndex && styles.commandActive,
										)}
									>
										<span {...stylex.props(styles.commandIcon)}>
											{command.icon}
										</span>
										<span {...stylex.props(styles.commandCopy)}>
											<span {...stylex.props(styles.commandLabel)}>
												{command.label}
											</span>
											<span {...stylex.props(styles.commandDetail)}>
												{command.detail}
											</span>
										</span>
									</button>
								))
							) : (
								<div {...stylex.props(styles.empty)}>No matching commands</div>
							)}
						</div>
					</section>
				</div>
			) : null}
		</>
	);
}

const styles = stylex.create({
	trigger: {
		display: "flex",
		height: controlSize._8,
		alignItems: "center",
		gap: controlSize._2,
		paddingInline: controlSize._2,
		borderWidth: controlSize._0,
		borderRadius: radius.md,
		backgroundColor: {
			default: color.surfaceWhite06,
			":hover": color.surfaceWhite10,
		},
		color: color.textMain,
	},
	triggerLabel: { fontSize: font.size_2, fontWeight: font.weight_5 },
	shortcut: {
		color: color.textMuted,
		fontFamily: "inherit",
		fontSize: font.size_1,
	},
	backdrop: {
		position: "fixed",
		inset: controlSize._0,
		zIndex: layer.modal,
		display: "flex",
		alignItems: "flex-start",
		justifyContent: "center",
		paddingTop: "15vh",
		backgroundColor: "rgba(0,0,0,0.36)",
		backdropFilter: "blur(3px)",
		pointerEvents: "auto",
	},
	palette: {
		width: "min(31rem, calc(100vw - 32px))",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.lg,
		backgroundColor: color.headerPopoverOpaque,
		boxShadow: shadow.popover,
	},
	search: {
		display: "flex",
		height: 48,
		alignItems: "center",
		gap: controlSize._2,
		paddingInline: controlSize._3,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		color: color.textSoft,
	},
	input: {
		flex: 1,
		minWidth: controlSize._0,
		borderWidth: controlSize._0,
		outline: "none",
		backgroundColor: color.transparent,
		color: color.textMain,
		fontSize: font.size_3,
	},
	escape: {
		paddingBlock: controlSize._1,
		paddingInline: controlSize._1_5,
		borderRadius: radius.sm,
		backgroundColor: color.surfaceWhite06,
		color: color.textMuted,
		fontFamily: "inherit",
		fontSize: font.size_1,
	},
	results: {
		display: "flex",
		maxHeight: "22rem",
		flexDirection: "column",
		overflowY: "auto",
		padding: controlSize._1_5,
	},
	command: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._3,
		width: "100%",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
		borderWidth: controlSize._0,
		borderRadius: radius.md,
		backgroundColor: color.transparent,
		color: color.textSoft,
		textAlign: "left",
	},
	commandActive: {
		backgroundColor: color.surfaceWhite08,
		color: color.textMain,
	},
	commandIcon: {
		display: "flex",
		width: controlSize._7,
		height: controlSize._7,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.md,
		backgroundColor: color.surfaceWhite06,
	},
	commandCopy: {
		display: "flex",
		minWidth: controlSize._0,
		flexDirection: "column",
		gap: 2,
	},
	commandLabel: {
		color: "inherit",
		fontSize: font.size_2_75,
		fontWeight: font.weight_5,
	},
	commandDetail: { color: color.textMuted, fontSize: font.size_1 },
	empty: {
		padding: controlSize._6,
		color: color.textMuted,
		fontSize: font.size_2,
		textAlign: "center",
	},
});
