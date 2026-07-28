import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "octane";
import type { AgentKind, AgentTheme } from "../features/agent/agent-utils.ts";
import { wsClient } from "../lib/websocket.ts";

let xtermModulesPromise: Promise<{
	FitAddon: typeof import("@xterm/addon-fit").FitAddon;
	WebLinksAddon: typeof import("@xterm/addon-web-links").WebLinksAddon;
	XtermTerminal: typeof import("@xterm/xterm").Terminal;
}> | null = null;

function loadXtermModules() {
	xtermModulesPromise ??= Promise.all([
		import("@xterm/xterm"),
		import("@xterm/addon-fit"),
		import("@xterm/addon-web-links"),
	]).then(([xterm, fit, links]) => ({
		FitAddon: fit.FitAddon,
		WebLinksAddon: links.WebLinksAddon,
		XtermTerminal: xterm.Terminal,
	}));
	return xtermModulesPromise;
}

export function useXtermAgent({
	enabled,
	paneId,
	agentKind,
	cwd,
	isClaude,
	theme,
	fontSize,
	fontFamily,
}: {
	enabled: boolean;
	paneId: string;
	agentKind: AgentKind;
	cwd?: string;
	isClaude?: boolean;
	theme: Pick<AgentTheme, "bg" | "fg" | "cursor">;
	fontSize: number;
	fontFamily: string;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const termRef = useRef<XtermTerminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const initializedRef = useRef(false);
	const themeRef = useRef(theme);
	const fontSizeRef = useRef(fontSize);
	const fontFamilyRef = useRef(fontFamily);
	themeRef.current = theme;
	fontSizeRef.current = fontSize;
	fontFamilyRef.current = fontFamily;

	useEffect(() => {
		if (!enabled || !containerRef.current) return;
		let disposed = false;
		let cleanup: (() => void) | null = null;
		let setupFrame: number | null = null;
		let connectFrame: number | null = null;
		const container = containerRef.current;
		void loadXtermModules().then(
			({ FitAddon, WebLinksAddon, XtermTerminal }) => {
				if (disposed) return;
				initializedRef.current = false;
				const term = new XtermTerminal({
					allowProposedApi: true,
					cursorBlink: true,
					fontFamily: `"${fontFamilyRef.current}", monospace`,
					fontSize: fontSizeRef.current,
					scrollback: 1000,
					scrollOnUserInput: true,
					theme: {
						background: themeRef.current.bg,
						cursor: themeRef.current.cursor,
						foreground: themeRef.current.fg,
					},
				});
				const fitAddon = new FitAddon();
				term.loadAddon(fitAddon);
				term.loadAddon(new WebLinksAddon());
				term.open(container);
				termRef.current = term;
				fitRef.current = fitAddon;

				setupFrame = requestAnimationFrame(() => {
					const viewport =
						containerRef.current?.querySelector(".xterm-viewport");
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
				connectFrame = requestAnimationFrame(() => {
					fitAddon.fit();
					if (!initializedRef.current) {
						initializedRef.current = true;
						const dims = fitAddon.proposeDimensions();
						reconnectCleanup = wsClient.subscribe(paneId, (msg) => {
							if (msg.type !== "agent:reconnected") return;
							if (msg.ok) {
								if (typeof msg.buffer === "string" && termRef.current)
									termRef.current.write(msg.buffer);
							} else {
								wsClient.send({
									type: "agent:create",
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
						wsClient.send({ type: "agent:reconnect", paneId });
					}
					term.focus();
				});

				const dataDisposable = term.onData((data) => {
					wsClient.send({ type: "agent:input", paneId, data });
				});
				const resizeDisposable = term.onResize(({ cols, rows }) => {
					wsClient.send({ type: "agent:resize", paneId, cols, rows });
				});
				const cleanupMessage = wsClient.subscribe(paneId, (msg) => {
					if (msg.type === "agent:output" && typeof msg.data === "string") {
						term.write(msg.data);
					} else if (msg.type === "agent:exit") {
						term.write(
							`\r\n\x1b[90m[Process exited with code ${msg.exitCode ?? "unknown"}]\x1b[0m\r\n`
						);
					} else if (
						msg.type === "agent:reconnected" &&
						msg.ok &&
						typeof msg.buffer === "string"
					) {
						term.write(msg.buffer);
					}
				});
				const cleanupReconnect = wsClient.onReconnect(() => {
					wsClient.send({ type: "agent:reconnect", paneId });
				});
				let rafId: number | null = null;
				let lastWidth = 0;
				let lastHeight = 0;
				const resizeObserver = new ResizeObserver(() => {
					const element = containerRef.current;
					if (!element) return;
					const nextWidth = element.clientWidth;
					const nextHeight = element.clientHeight;
					if (nextWidth === lastWidth && nextHeight === lastHeight) return;
					lastWidth = nextWidth;
					lastHeight = nextHeight;
					if (rafId !== null) cancelAnimationFrame(rafId);
					rafId = requestAnimationFrame(() => {
						rafId = null;
						fitAddon.fit();
					});
				});
				resizeObserver.observe(container);

				cleanup = () => {
					reconnectCleanup?.();
					dataDisposable.dispose();
					resizeDisposable.dispose();
					cleanupMessage();
					cleanupReconnect();
					if (rafId !== null) cancelAnimationFrame(rafId);
					resizeObserver.disconnect();
					term.dispose();
					termRef.current = null;
					fitRef.current = null;
				};
			}
		);
		return () => {
			disposed = true;
			cleanup?.();
			if (setupFrame !== null) cancelAnimationFrame(setupFrame);
			if (connectFrame !== null) cancelAnimationFrame(connectFrame);
		};
	}, [enabled, paneId, agentKind, cwd, isClaude]);

	useEffect(() => {
		if (!termRef.current) return;
		termRef.current.options.theme = {
			background: theme.bg,
			foreground: theme.fg,
			cursor: theme.cursor,
		};
	}, [theme.bg, theme.cursor, theme.fg]);

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
