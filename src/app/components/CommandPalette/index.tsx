import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
} from "solid-js";
import { ariaValue } from "../../../shared/lib/dom.tsx";
import { IconSearch } from "../../../shared/ui/Icons/index.tsx";
import { APP_REGION_NO_DRAG_CLASS } from "../../hooks/useAppAppearance.tsx";
import { styles } from "./styles.ts";
export interface CommandPaletteItem {
	id: string;
	label: string;
	detail: string;
	icon: Element;
	keywords?: string;
	run: () => void;
}
export function CommandPalette(_props: {
	commands: readonly CommandPaletteItem[];
	showTrigger?: boolean;
}) {
	const [open, setOpen] = createSignal(false);
	const [query, setQuery] = createSignal("");
	const [activeIndex, setActiveIndex] = createSignal(() => {
		query();
		return 0;
	});
	const inputRef = {
		current: null,
	} as {
		current: HTMLInputElement | null;
	};
	const filteredCommands = createMemo(() => {
		const needle = query().trim().toLocaleLowerCase();
		if (!needle) return _props.commands;
		return _props.commands.filter((command) =>
			`${command.label} ${command.detail} ${command.keywords ?? ""}`
				.toLocaleLowerCase()
				.includes(needle),
		);
	});
	onSettled(() => {
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
	});
	createEffect(
		() => [open()],
		() => {
			if (!open()) {
				setQuery("");
				setActiveIndex(0);
				return;
			}
			requestAnimationFrame(() => inputRef.current?.focus());
		},
	);
	const execute = (command: CommandPaletteItem | undefined) => {
		if (!command) return;
		setOpen(false);
		command.run();
	};
	return (
		<>
			{(_props.showTrigger === undefined ? true : _props.showTrigger) ? (
				<button
					type="button"
					onClick={() => setOpen(true)}
					class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.trigger).class ?? ""}`}
					aria-label="Open command palette"
					title="Open command palette (⌘K)"
				>
					<IconSearch size={14} />
					<span {...stylex.attrs(styles.triggerLabel)}>Command</span>
					<kbd {...stylex.attrs(styles.shortcut)}>⌘K</kbd>
				</button>
			) : null}
			{open() ? (
				<div
					role="presentation"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setOpen(false);
					}}
					{...stylex.attrs(styles.backdrop)}
				>
					<section
						role="dialog"
						aria-modal="true"
						aria-label="Command palette"
						{...stylex.attrs(styles.palette)}
						class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.palette).class ?? ""}`}
					>
						<label {...stylex.attrs(styles.search)}>
							<IconSearch size={16} />
							<input
								ref={(element) => (inputRef.current = element)}
								value={query()}
								onInput={(event) => setQuery(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										setOpen(false);
									} else if (event.key === "ArrowDown") {
										event.preventDefault();
										setActiveIndex((current) =>
											Math.min(filteredCommands().length - 1, current + 1),
										);
									} else if (event.key === "ArrowUp") {
										event.preventDefault();
										setActiveIndex((current) => Math.max(0, current - 1));
									} else if (event.key === "Enter") {
										event.preventDefault();
										execute(filteredCommands()[activeIndex()]);
									}
								}}
								placeholder="What do you want to do?"
								aria-label="Search commands"
								{...stylex.attrs(styles.input)}
							/>
							<kbd {...stylex.attrs(styles.escape)}>esc</kbd>
						</label>
						<div role="listbox" {...stylex.attrs(styles.results)}>
							{filteredCommands().length ? (
								<For each={filteredCommands()} keyed={(row) => row.id}>
									{(command, index) => {
										const _activeIndexValue = activeIndex();
										return (
											<button
												type="button"
												role="option"
												aria-selected={ariaValue(index() === _activeIndexValue)}
												onMouseEnter={() => setActiveIndex(index())}
												onClick={() => execute(command())}
												{...stylex.attrs(
													styles.command,
													index() === _activeIndexValue && styles.commandActive,
												)}
											>
												<span {...stylex.attrs(styles.commandIcon)}>
													{command().icon}
												</span>
												<span {...stylex.attrs(styles.commandCopy)}>
													<span {...stylex.attrs(styles.commandLabel)}>
														{command().label}
													</span>
													<span {...stylex.attrs(styles.commandDetail)}>
														{command().detail}
													</span>
												</span>
											</button>
										);
									}}
								</For>
							) : (
								<div {...stylex.attrs(styles.empty)}>No matching commands</div>
							)}
						</div>
					</section>
				</div>
			) : null}
		</>
	);
}
