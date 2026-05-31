import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import type {
	AgentKind,
	TerminalTheme,
} from "../features/terminal/terminal-utils.ts";
import { wsClient } from "../lib/websocket.ts";

export function useXtermTerminal({
	enabled,
	paneId,
	agentKind,
	cwd,
	isClaude,
	theme,
	fontSize,
	fontFamily,
	onSelectionChange,
}: {
	enabled: boolean;
	paneId: string;
	agentKind: AgentKind;
	cwd?: string;
	isClaude?: boolean;
	theme: Pick<TerminalTheme, "bg" | "fg" | "cursor">;
	fontSize: number;
	fontFamily: string;
	onSelectionChange?: (selection: string) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const initializedRef = useRef(false);

	useEffect(() => {
		if (!enabled || !containerRef.current) return;
		initializedRef.current = false;
		const term = new Terminal({
			cursorBlink: true,
			fontSize,
			fontFamily: `"${fontFamily}", monospace`,
			theme: {
				background: theme.bg,
				foreground: theme.fg,
				cursor: theme.cursor,
			},
			allowProposedApi: true,
			scrollback: 1000,
			scrollOnUserInput: true,
		});
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.loadAddon(new WebLinksAddon());
		term.open(containerRef.current);
		termRef.current = term;
		fitRef.current = fitAddon;

		requestAnimationFrame(() => {
			const viewport = containerRef.current?.querySelector(".xterm-viewport");
			if (viewport instanceof HTMLElement) {
				viewport.style.overflow = "hidden";
				viewport.style.scrollbarWidth = "none";
				viewport.style.setProperty("-ms-overflow-style", "none");
			}
			const xtermElement = containerRef.current?.querySelector(".xterm");
			if (xtermElement instanceof HTMLElement)
				xtermElement.style.overflow = "hidden";
		});

		let reconnectCleanup: (() => void) | null = null;
		requestAnimationFrame(() => {
			fitAddon.fit();
			if (!initializedRef.current) {
				initializedRef.current = true;
				const dims = fitAddon.proposeDimensions();
				reconnectCleanup = wsClient.subscribe(paneId, (msg: any) => {
					if (msg.type !== "terminal:reconnected") return;
					if (msg.ok) {
						if (msg.buffer && termRef.current)
							termRef.current.write(msg.buffer);
					} else {
						wsClient.send({
							type: "terminal:create",
							paneId,
							agentKind,
							isClaude,
							cwd,
							cols: dims?.cols ?? 80,
							rows: dims?.rows ?? 24,
						});
					}
					termRef.current?.focus();
					reconnectCleanup?.();
					reconnectCleanup = null;
				});
				wsClient.send({ type: "terminal:reconnect", paneId });
			}
			term.focus();
		});

		const dataDisposable = term.onData((data) => {
			wsClient.send({ type: "terminal:input", paneId, data });
		});
		const resizeDisposable = term.onResize(({ cols, rows }) => {
			wsClient.send({ type: "terminal:resize", paneId, cols, rows });
		});
		const selectionDisposable = term.onSelectionChange(() => {
			onSelectionChange?.(term.getSelection());
		});
		const cleanupMessage = wsClient.subscribe(paneId, (msg: any) => {
			if (msg.type === "terminal:output") term.write(msg.data);
			else if (msg.type === "terminal:exit")
				term.write(
					`\r\n\x1b[90m[Process exited with code ${msg.exitCode ?? "unknown"}]\x1b[0m\r\n`
				);
			else if (msg.type === "terminal:reconnected" && msg.ok && msg.buffer)
				term.write(msg.buffer);
		});
		const cleanupReconnect = wsClient.onReconnect(() => {
			wsClient.send({ type: "terminal:reconnect", paneId });
		});
		let rafId: number | null = null;
		const resizeObserver = new ResizeObserver(() => {
			if (rafId !== null) cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => {
				rafId = null;
				fitAddon.fit();
			});
		});
		resizeObserver.observe(containerRef.current);

		return () => {
			reconnectCleanup?.();
			dataDisposable.dispose();
			resizeDisposable.dispose();
			selectionDisposable.dispose();
			cleanupMessage();
			cleanupReconnect();
			if (rafId !== null) cancelAnimationFrame(rafId);
			resizeObserver.disconnect();
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, [
		enabled,
		paneId,
		agentKind,
		cwd,
		isClaude,
		fontFamily,
		fontSize,
		onSelectionChange,
		theme.bg,
		theme.cursor,
		theme.fg,
	]);

	useEffect(() => {
		if (!termRef.current) return;
		termRef.current.options.theme = {
			background: theme.bg,
			foreground: theme.fg,
			cursor: theme.cursor,
		};
	}, [theme]);

	useEffect(() => {
		if (!termRef.current) return;
		termRef.current.options.fontSize = fontSize;
		termRef.current.options.fontFamily = `"${fontFamily}", monospace`;
		fitRef.current?.fit();
	}, [fontSize, fontFamily]);

	const refit = useCallback(
		() =>
			requestAnimationFrame(() => {
				fitRef.current?.fit();
				termRef.current?.focus();
			}),
		[]
	);

	return { containerRef, termRef, refit };
}
