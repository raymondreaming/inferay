import { useCallback } from "react";
import type React from "react";

export interface ComposerKeyboardActions {
	onSubmit: () => void;
	onScrollChatByArrow: (direction: 1 | -1) => void;
	composerOnly?: boolean;
	onExitComposerOnly?: () => void;
}

interface MenuState {
	show: boolean;
	selectedIdx: number;
}

interface UseChatComposerKeyboardOptions<
	FileMenu extends MenuState,
	CommandMenu extends MenuState,
> {
	input: string;
	keyboard: ComposerKeyboardActions;
	fileMenu: Pick<FileMenu, "show" | "selectedIdx">;
	fileResultCount: number;
	setFileMenu: React.Dispatch<React.SetStateAction<FileMenu>>;
	selectFile: (idx: number) => void;
	showCommands: boolean;
	commandMenu: Pick<CommandMenu, "selectedIdx">;
	commandCount: number;
	setCommandMenu: React.Dispatch<React.SetStateAction<CommandMenu>>;
	selectCommand: (idx: number) => void;
}

function useMenuKeyHandler() {
	return useCallback(
		<S extends MenuState>(
			event: React.KeyboardEvent,
			count: number,
			setMenu: React.Dispatch<React.SetStateAction<S>>,
			selectIdx: number,
			onSelect: (idx: number) => void
		): boolean => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setMenu((prev) => ({
					...prev,
					selectedIdx: (prev.selectedIdx + 1) % count,
				}));
				return true;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setMenu((prev) => ({
					...prev,
					selectedIdx: (prev.selectedIdx - 1 + count) % count,
				}));
				return true;
			}
			if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
				event.preventDefault();
				onSelect(selectIdx);
				return true;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setMenu((prev) => ({ ...prev, show: false }));
				return true;
			}
			return false;
		},
		[]
	);
}

export function useChatComposerKeyboard<
	FileMenu extends MenuState,
	CommandMenu extends MenuState,
>({
	input,
	keyboard,
	fileMenu,
	fileResultCount,
	setFileMenu,
	selectFile,
	showCommands,
	commandMenu,
	commandCount,
	setCommandMenu,
	selectCommand,
}: UseChatComposerKeyboardOptions<FileMenu, CommandMenu>) {
	const handleMenuKey = useMenuKeyHandler();

	return useCallback(
		(event: React.KeyboardEvent) => {
			if (
				fileMenu.show &&
				fileResultCount > 0 &&
				handleMenuKey(
					event,
					fileResultCount,
					setFileMenu,
					fileMenu.selectedIdx,
					selectFile
				)
			) {
				return;
			}
			if (
				showCommands &&
				commandCount > 0 &&
				handleMenuKey(
					event,
					commandCount,
					setCommandMenu,
					commandMenu.selectedIdx,
					selectCommand
				)
			) {
				return;
			}

			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				keyboard.onSubmit();
			} else if (
				(event.key === "ArrowDown" || event.key === "ArrowUp") &&
				input.trim().length === 0 &&
				!event.altKey &&
				!event.ctrlKey &&
				!event.metaKey &&
				!event.shiftKey
			) {
				event.preventDefault();
				keyboard.onScrollChatByArrow(event.key === "ArrowDown" ? 1 : -1);
			} else if (keyboard.composerOnly && event.key === "Escape") {
				event.preventDefault();
				keyboard.onExitComposerOnly?.();
			}
		},
		[
			commandCount,
			commandMenu.selectedIdx,
			fileMenu.show,
			fileMenu.selectedIdx,
			fileResultCount,
			handleMenuKey,
			input,
			keyboard,
			selectCommand,
			selectFile,
			setCommandMenu,
			setFileMenu,
			showCommands,
		]
	);
}
