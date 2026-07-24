import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import {
	createAgentPane,
	normalizeAgentState,
} from "../src/features/agent/agent-utils.ts";

const SERVER_START_TIMEOUT_MS = 10_000;
const WS_TIMEOUT_MS = 5_000;

let childProcess: ReturnType<typeof Bun.spawn> | null = null;
let tempHome: string | null = null;

afterEach(async () => {
	if (childProcess) {
		childProcess.kill();
		await childProcess.exited.catch(() => {});
		childProcess = null;
	}
	if (tempHome) {
		await rm(tempHome, { recursive: true, force: true });
		tempHome = null;
	}
});

describe("app persistence restore flow", () => {
	test("normalizes stale selected workspace to the best recoverable group", () => {
		const realPane = {
			...createAgentPane("codex", "/Users/ray/Developer/inferay"),
			id: "real-pane" as never,
		};
		const stalePane = {
			...createAgentPane("codex", undefined, true),
			id: "blank-pane" as never,
		};
		const normalized = normalizeAgentState({
			groups: [
				{
					id: "blank-workspace",
					name: "Blank",
					panes: [stalePane],
					selectedPaneId: stalePane.id,
					columns: 3,
					rows: 2,
				},
				{
					id: "real-workspace",
					name: "Real",
					panes: [realPane],
					selectedPaneId: realPane.id,
					columns: 3,
					rows: 2,
				},
			],
			selectedGroupId: "missing-workspace",
			themeId: "default",
			fontSize: 13,
			fontFamily: "SF Mono",
			opacity: 1,
		});

		expect(normalized?.selectedGroupId).toBe("real-workspace" as never);
		expect(normalized?.groups).toHaveLength(2);
		expect(normalized?.groups[1]?.panes[0]?.id).toBe("real-pane" as never);
	});

	test("hydrates real workspace panes and chat transcripts from durable server state", async () => {
		const port = await new Promise<number>((resolve, reject) => {
			const server = createServer();
			server.on("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				server.close(() => {
					if (address && typeof address === "object") resolve(address.port);
					else reject(new Error("Could not allocate a test server port"));
				});
			});
		});
		const origin = `http://127.0.0.1:${port}`;
		tempHome = await mkdtemp(join(tmpdir(), "inferay-persistence-home-"));
		await installFakeCodex(tempHome);
		childProcess = startIsolatedServer(port, tempHome);
		await waitForServerReady(childProcess);

		const cookie = await readAuthCookie(origin);
		const headers = {
			Cookie: cookie,
			"Content-Type": "application/json",
			"Sec-Fetch-Site": "same-origin",
		};

		const state = createWorkspaceState();
		const agentResponse = await fetch(`${origin}/api/agent/state`, {
			method: "POST",
			headers,
			body: JSON.stringify(state),
		});
		expect(agentResponse.ok).toBe(true);

		await sendGoalStatusMessages(origin, cookie, state);

		const staleState = {
			...state,
			groups: [
				{
					...state.groups[1]!,
					panes: [
						{
							...state.groups[1]!.panes[1]!,
							title: "Codex",
							cwd: undefined,
							pendingCwd: true,
						},
					],
				},
			],
			selectedGroupId: state.groups[1]!.id,
		};
		const beaconStyleResponse = await fetch(`${origin}/api/client-storage`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				entries: {
					"inferay-agent-state": JSON.stringify(staleState),
					[`inferay-chat-${state.groups[0]!.panes[0]!.id}`]: "[]",
				},
			}),
		});
		expect(beaconStyleResponse.ok).toBe(true);

		const snapshotResponse = await fetch(`${origin}/api/client-storage`, {
			headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
		});
		expect(snapshotResponse.ok).toBe(true);
		const snapshot = (await snapshotResponse.json()) as {
			entries: Record<string, string>;
		};
		expect(snapshot.entries["inferay-agent-state"]).toBeUndefined();

		const canonicalStateResponse = await fetch(`${origin}/api/agent/state`, {
			headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
		});
		expect(canonicalStateResponse.ok).toBe(true);
		const hydratedState = await canonicalStateResponse.json();
		expect(hydratedState.groups.map((group: any) => group.name)).toEqual([
			"Persistence Alpha",
			"Persistence Beta",
		]);
		expect(hydratedState.selectedGroupId).toBe("workspace-beta");
		expect(hydratedState.groups[0].panes.map((pane: any) => pane.cwd)).toEqual([
			"/Users/ray/Developer/inferay",
			"/Users/ray/Developer/inferay/tests",
		]);
		expect(
			hydratedState.groups[0].panes.map((pane: any) => pane.title)
		).toEqual(["inferay", "tests"]);
		expect(hydratedState.groups[1].panes.map((pane: any) => pane.cwd)).toEqual([
			"/Users/ray/Developer/inferay/src",
			"/Users/ray/Developer/inferay/site",
		]);
		expect(
			hydratedState.groups[1].panes.map((pane: any) => pane.title)
		).toEqual(["src", "site"]);
		expect(
			hydratedState.groups.flatMap((group: any) =>
				group.panes.map((pane: any) => pane.cwd.split("/").pop())
			)
		).toEqual(["inferay", "tests", "src", "site"]);

		const sessionsResponse = await fetch(`${origin}/api/sessions`, {
			headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
		});
		expect(sessionsResponse.ok).toBe(true);
		const sessionsPayload = (await sessionsResponse.json()) as {
			sessions: Array<{
				paneId: string;
				cwd: string | null;
				messageCount: number;
			}>;
		};
		expect(
			sessionsPayload.sessions.map((session) => session.paneId).sort()
		).toEqual(
			state.groups.flatMap((group) => group.panes.map((pane) => pane.id)).sort()
		);
		expect(
			sessionsPayload.sessions.find((session) => session.paneId === "beta-two")
				?.cwd
		).toBe("/Users/ray/Developer/inferay/site");

		const uiMirror = await hydrateRendererStorageSnapshot(origin, cookie);
		expect(uiMirror.selectedGroupId).toBe("workspace-beta");
		expect(uiMirror.groups.map((group: any) => group.name)).toEqual([
			"Persistence Alpha",
			"Persistence Beta",
		]);
		expect(uiMirror.groups[1].selectedPaneId).toBe("beta-two");
		expect(uiMirror.groups[1].panes[1].cwd).toBe(
			"/Users/ray/Developer/inferay/site"
		);
		expect(uiMirror.groups[1].panes[1].title).toBe("site");

		childProcess.kill();
		await childProcess.exited.catch(() => {});
		childProcess = startIsolatedServer(port, tempHome);
		await waitForServerReady(childProcess);

		const restartedCookie = await readAuthCookie(origin);
		const reconnectWs = newTestWebSocket(origin, restartedCookie);
		await waitForOpen(reconnectWs);
		try {
			reconnectWs.send(
				JSON.stringify({ type: "chat:reconnect", paneId: "beta-two" })
			);
			const restored = await waitForChatSync(reconnectWs, "beta-two");
			expect(restored.messages.map((message: any) => message.role)).toEqual([
				"user",
				"system",
			]);

			reconnectWs.send(
				JSON.stringify({
					type: "chat:send",
					paneId: "beta-two",
					text: "/goal status",
					cwd: "/Users/ray/Developer/inferay/site",
					referencePaths: [],
					agentKind: "codex",
					reasoningLevel: "medium",
				})
			);
			const continued = await waitForChatSync(reconnectWs, "beta-two");
			expect(continued.messages.map((message: any) => message.role)).toEqual([
				"user",
				"system",
				"user",
				"system",
			]);

			reconnectWs.send(
				JSON.stringify({
					type: "chat:send",
					paneId: "beta-two",
					text: "stream partial restore please",
					cwd: "/Users/ray/Developer/inferay/site",
					referencePaths: [],
					agentKind: "codex",
					reasoningLevel: "medium",
				})
			);
			await waitForChatEvent(reconnectWs, "beta-two", (event) => {
				return (
					event?.type === "content_block_delta" &&
					event.delta?.type === "text_delta" &&
					String(event.delta.text).includes("partial restore content")
				);
			});
			await new Promise((resolve) => setTimeout(resolve, 400));

			childProcess.kill();
			await childProcess.exited.catch(() => {});
			childProcess = startIsolatedServer(port, tempHome);
			await waitForServerReady(childProcess);

			const partialCookie = await readAuthCookie(origin);
			const partialWs = newTestWebSocket(origin, partialCookie);
			await waitForOpen(partialWs);
			try {
				partialWs.send(
					JSON.stringify({ type: "chat:reconnect", paneId: "beta-two" })
				);
				const partialRestore = await waitForChatSync(partialWs, "beta-two");
				const lastMessage = partialRestore.messages.at(-1);
				expect(lastMessage.role).toBe("assistant");
				expect(lastMessage.content).toContain("partial restore content");
				expect(lastMessage.isStreaming).toBe(false);

				const rendered = await renderCompiledAppSnapshot(origin, partialCookie);
				expect(rendered.mainView).toBe("chat");
				expect(rendered.text).toContain("Persistence Beta");
				expect(rendered.text).toContain("site");
			} finally {
				partialWs.close();
			}
		} finally {
			reconnectWs.close();
		}
	}, 20_000);
});

function startIsolatedServer(port: number, home: string) {
	const fakeCodexPath = join(home, "bin", "codex");
	return Bun.spawn({
		cmd: [
			"bun",
			"--eval",
			[
				`import { startAppServer } from ${JSON.stringify(
					`${process.cwd()}/src/server/app-server.ts`
				)};`,
				`await startAppServer(${port});`,
				`console.log("READY");`,
				`await new Promise(() => {});`,
			].join("\n"),
		],
		cwd: process.cwd(),
		env: { ...process.env, CODEX_PATH: fakeCodexPath, HOME: home },
		stdout: "pipe",
		stderr: "pipe",
	});
}

async function installFakeCodex(home: string): Promise<void> {
	const binDir = join(home, "bin");
	const codexPath = join(binDir, "codex");
	await mkdir(binDir, { recursive: true });
	await writeFile(
		codexPath,
		[
			"#!/usr/bin/env bun",
			'console.log(JSON.stringify({ type: "agent_message_delta", delta: "partial restore content" }));',
			"await new Promise((resolve) => setTimeout(resolve, 30_000));",
		].join("\n")
	);
	await chmod(codexPath, 0o755);
}

async function hydrateRendererStorageSnapshot(
	origin: string,
	cookie: string
): Promise<any> {
	const originalFetch = globalThis.fetch;
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: `${origin}/#/agent`,
	});
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const previousDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		"document"
	);
	const previousLocalStorage = Object.getOwnPropertyDescriptor(
		globalThis,
		"localStorage"
	);
	const previousNavigator = Object.getOwnPropertyDescriptor(
		globalThis,
		"navigator"
	);
	const previousCustomEvent = Object.getOwnPropertyDescriptor(
		globalThis,
		"CustomEvent"
	);
	const previousEvent = Object.getOwnPropertyDescriptor(globalThis, "Event");
	try {
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: dom.window,
		});
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: dom.window.document,
		});
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: dom.window.localStorage,
		});
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: dom.window.navigator,
		});
		Object.defineProperty(globalThis, "CustomEvent", {
			configurable: true,
			value: dom.window.CustomEvent,
		});
		Object.defineProperty(globalThis, "Event", {
			configurable: true,
			value: dom.window.Event,
		});
		dom.window.localStorage.setItem(
			"inferay-agent-state",
			JSON.stringify({
				groups: [
					{
						id: "workspace-beta",
						name: "Persistence Beta",
						panes: [
							{
								id: "beta-two",
								title: "Codex",
								agentKind: "codex",
								isClaude: false,
								paneType: "codex",
								pendingCwd: true,
							},
						],
						selectedPaneId: "beta-two",
						columns: 3,
						rows: 2,
					},
				],
				selectedGroupId: "workspace-beta",
				themeId: "default",
				fontSize: 13,
				fontFamily: "SF Mono",
				opacity: 1,
			})
		);
		globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
			const url =
				typeof input === "string" && input.startsWith("/")
					? `${origin}${input}`
					: input;
			return originalFetch(url, {
				...init,
				headers: {
					...(init.headers ?? {}),
					Cookie: cookie,
					"Sec-Fetch-Site": "same-origin",
				},
			});
		}) as typeof fetch;

		const { hydrateStoredValues } =
			await import("../src/lib/client-storage-sync.ts");
		const { loadAgentState } =
			await import("../src/features/agent/agent-utils.ts");

		expect(loadAgentState()?.groups[0]?.panes).toHaveLength(1);
		await hydrateStoredValues();
		return loadAgentState();
	} finally {
		globalThis.fetch = originalFetch;
		if (previousWindow)
			Object.defineProperty(globalThis, "window", previousWindow);
		else delete (globalThis as { window?: unknown }).window;
		if (previousDocument)
			Object.defineProperty(globalThis, "document", previousDocument);
		else delete (globalThis as { document?: unknown }).document;
		if (previousLocalStorage)
			Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
		else delete (globalThis as { localStorage?: unknown }).localStorage;
		if (previousNavigator)
			Object.defineProperty(globalThis, "navigator", previousNavigator);
		else delete (globalThis as { navigator?: unknown }).navigator;
		if (previousCustomEvent)
			Object.defineProperty(globalThis, "CustomEvent", previousCustomEvent);
		else delete (globalThis as { CustomEvent?: unknown }).CustomEvent;
		if (previousEvent)
			Object.defineProperty(globalThis, "Event", previousEvent);
		else delete (globalThis as { Event?: unknown }).Event;
	}
}

async function renderCompiledAppSnapshot(
	origin: string,
	cookie: string
): Promise<{ mainView: string | null; text: string }> {
	const mainPath = join(process.cwd(), "dist", "main.js");
	if (!existsSync(mainPath)) {
		await runRendererBuild();
	}

	const script = `
		import { JSDOM } from "jsdom";
		const origin = ${JSON.stringify(origin)};
		const cookie = ${JSON.stringify(cookie)};
		const mainUrl = ${JSON.stringify(pathToFileURL(mainPath).href)};
		const originalFetch = globalThis.fetch;
		const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
			url: origin + "/#/agent",
			pretendToBeVisual: true,
		});
		dom.window.localStorage.setItem("inferay-agent-state", JSON.stringify({
			groups: [{
				id: "workspace-beta",
				name: "Persistence Beta",
				panes: [{
					id: "beta-two",
					title: "Codex",
					agentKind: "codex",
					isClaude: false,
					paneType: "codex",
					pendingCwd: true,
				}],
				selectedPaneId: "beta-two",
				columns: 3,
				rows: 2,
			}],
			selectedGroupId: "workspace-beta",
			themeId: "default",
			fontSize: 13,
			fontFamily: "SF Mono",
			opacity: 1,
		}));
		dom.window.localStorage.setItem("agent-main-view", "editor");
		Object.assign(globalThis, {
			window: dom.window,
			document: dom.window.document,
			navigator: dom.window.navigator,
			localStorage: dom.window.localStorage,
			sessionStorage: dom.window.sessionStorage,
			CustomEvent: dom.window.CustomEvent,
			Event: dom.window.Event,
			HTMLElement: dom.window.HTMLElement,
			HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
			HTMLInputElement: dom.window.HTMLInputElement,
			MutationObserver: dom.window.MutationObserver,
			ResizeObserver: class {
				constructor(callback) { this.callback = callback; }
				observe(target) {
					this.callback([{ target, contentRect: createDomRect(1200, 800) }], this);
				}
				unobserve() {}
				disconnect() {}
			},
			requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
			cancelAnimationFrame: (id) => clearTimeout(id),
			WebSocket,
		});
		Object.defineProperties(dom.window.HTMLElement.prototype, {
			clientHeight: { configurable: true, get: () => 800 },
			clientWidth: { configurable: true, get: () => 1200 },
			offsetHeight: { configurable: true, get: () => 800 },
			offsetWidth: { configurable: true, get: () => 1200 },
		});
		dom.window.HTMLElement.prototype.getBoundingClientRect = () => createDomRect(1200, 800);
		dom.window.HTMLCanvasElement.prototype.getContext = () => ({
			arc() {}, beginPath() {}, clearRect() {}, createLinearGradient: () => ({ addColorStop() {} }),
			fill() {}, fillRect() {}, fillText() {}, lineTo() {}, measureText: (text) => ({ width: String(text).length * 8 }),
			moveTo() {}, restore() {}, save() {}, scale() {}, stroke() {}, translate() {},
		});
		dom.window.matchMedia = () => ({
			addEventListener() {}, addListener() {}, dispatchEvent: () => false, matches: false,
			removeEventListener() {}, removeListener() {},
		});
		dom.window.requestIdleCallback = (callback) =>
			setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 10 }), 0);
		globalThis.fetch = dom.window.fetch = (input, init = {}) => {
			const url = typeof input === "string" && input.startsWith("/") ? origin + input : input;
			return originalFetch(url, {
				...init,
				headers: { ...(init.headers ?? {}), Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
			});
		};
		await import(mainUrl + "?persistence=" + Date.now() + "-" + Math.random());
		await new Promise((resolve) => setTimeout(resolve, 6000));
		console.log(JSON.stringify({
			mainView: dom.window.localStorage.getItem("agent-main-view"),
			text: dom.window.document.body.textContent ?? "",
		}));
		process.exit(0);
		function createDomRect(width, height) {
			return { bottom: height, height, left: 0, right: width, top: 0, width, x: 0, y: 0, toJSON() { return this; } };
		}
	`;
	const proc = Bun.spawn(["bun", "--eval", script], {
		cwd: process.cwd(),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`Compiled app render failed: ${stderr}`);
	}
	return JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
}

async function runRendererBuild(): Promise<void> {
	const proc = Bun.spawn(["bun", "run", "build:renderer"], {
		cwd: process.cwd(),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`Renderer build failed before UI restore check: ${stderr}`);
	}
}

async function waitForServerReady(
	proc: ReturnType<typeof Bun.spawn>
): Promise<void> {
	const stdout = proc.stdout;
	if (!stdout || typeof stdout === "number") {
		throw new Error("Inferay test server stdout is unavailable");
	}
	const reader = stdout.getReader();
	const stderrPromise =
		proc.stderr && typeof proc.stderr !== "number"
			? new Response(proc.stderr).text()
			: Promise.resolve("");
	const decoder = new TextDecoder();
	let output = "";
	const timeout = Date.now() + SERVER_START_TIMEOUT_MS;
	while (Date.now() < timeout) {
		const result = await Promise.race([
			reader.read(),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
		]);
		if (!result) continue;
		if (result.done) break;
		output += decoder.decode(result.value);
		if (output.includes("READY")) return;
	}
	throw new Error(
		`Inferay test server did not start. Output: ${output}${await stderrPromise}`
	);
}

async function readAuthCookie(origin: string): Promise<string> {
	const response = await fetch(`${origin}/logo.png`, {
		headers: { "Sec-Fetch-Site": "same-origin" },
	});
	const cookie = response.headers.get("set-cookie")?.split(";")[0];
	if (!cookie) throw new Error("Test server did not return auth cookie");
	return cookie;
}

function createWorkspaceState() {
	const pane = (id: string, cwd: string) => ({
		...createAgentPane("codex", cwd, false),
		id,
		referencePaths: [],
	});
	return {
		groups: [
			{
				id: "workspace-alpha",
				name: "Persistence Alpha",
				panes: [
					pane("alpha-one", "/Users/ray/Developer/inferay"),
					pane("alpha-two", "/Users/ray/Developer/inferay/tests"),
				],
				selectedPaneId: "alpha-two",
				columns: 2,
				rows: 1,
			},
			{
				id: "workspace-beta",
				name: "Persistence Beta",
				panes: [
					pane("beta-one", "/Users/ray/Developer/inferay/src"),
					pane("beta-two", "/Users/ray/Developer/inferay/site"),
				],
				selectedPaneId: "beta-two",
				columns: 2,
				rows: 1,
			},
		],
		selectedGroupId: "workspace-beta",
		themeId: "default",
		fontSize: 13,
		fontFamily: "SF Mono",
		opacity: 1,
	};
}

async function sendGoalStatusMessages(
	origin: string,
	cookie: string,
	state: ReturnType<typeof createWorkspaceState>
): Promise<void> {
	const ws = newTestWebSocket(origin, cookie);
	await waitForOpen(ws);
	try {
		for (const group of state.groups) {
			for (const pane of group.panes) {
				ws.send(
					JSON.stringify({
						type: "chat:send",
						paneId: pane.id,
						text: "/goal status",
						cwd: pane.cwd,
						referencePaths: pane.referencePaths,
						agentKind: "codex",
						reasoningLevel: "medium",
					})
				);
				await waitForChatSync(ws, pane.id);
			}
		}
	} finally {
		ws.close();
	}
}

function newTestWebSocket(origin: string, cookie: string): WebSocket {
	return new (WebSocket as any)(`${origin.replace("http:", "ws:")}/ws`, {
		headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
	}) as WebSocket;
}

function waitForOpen(ws: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error("Timed out waiting for websocket open")),
			WS_TIMEOUT_MS
		);
		ws.addEventListener("open", () => {
			clearTimeout(timeout);
			resolve();
		});
		ws.addEventListener("error", () => {
			clearTimeout(timeout);
			reject(new Error("WebSocket connection failed"));
		});
	});
}

function waitForChatSync(ws: WebSocket, paneId: string): Promise<any> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`Timed out waiting for chat sync for ${paneId}`)),
			WS_TIMEOUT_MS
		);
		const onMessage = (event: MessageEvent) => {
			const message = JSON.parse(String(event.data));
			if (message.type === "chat:sync" && message.paneId === paneId) {
				clearTimeout(timeout);
				ws.removeEventListener("message", onMessage);
				resolve(message);
			}
		};
		ws.addEventListener("message", onMessage);
	});
}

function waitForChatEvent(
	ws: WebSocket,
	paneId: string,
	matches: (event: any) => boolean
): Promise<any> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`Timed out waiting for chat event for ${paneId}`)),
			WS_TIMEOUT_MS
		);
		const onMessage = (event: MessageEvent) => {
			const message = JSON.parse(String(event.data));
			if (
				message.type === "chat:event" &&
				message.paneId === paneId &&
				matches(message.event)
			) {
				clearTimeout(timeout);
				ws.removeEventListener("message", onMessage);
				resolve(message.event);
			}
		};
		ws.addEventListener("message", onMessage);
	});
}
