import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { noop } from "../lib/data.ts";
import { PROJECT_ROOT } from "../lib/user-data.ts";
import { AgentService } from "./routes/agent.ts";
import { buildApiRoutes, handlePromptRequest } from "./routes/api.ts";
import {
	isTrustedLocalOrigin,
	isTrustedLocalRequest,
	isWithinDirectory,
	localAuthCookieHeader,
} from "./security.ts";
import { ChatService } from "./services/agent-chat.ts";
import { CheckpointService } from "./services/checkpoint.ts";
import { PidTracker } from "./services/pid-tracker.ts";
import { websocketHandler } from "./ws.ts";

const apiRoutes = buildApiRoutes();
const publicDir = resolve(PROJECT_ROOT, "public");
// In bundle the electrobun config copies dist/* → views/*
const distDir = existsSync(resolve(PROJECT_ROOT, "dist"))
	? resolve(PROJECT_ROOT, "dist")
	: resolve(PROJECT_ROOT, "views");
const BASE_CORS_HEADERS = {
	"Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type,X-Inferay-Auth",
};

const g = globalThis as typeof globalThis & {
	__agent_gui_server?: ReturnType<typeof Bun.serve>;
	__agent_gui_shutdown_handlers_installed?: boolean;
};
type AppUpgradeServer = {
	upgrade: (
		req: Request,
		options: { data: { subscriptions: Set<string> } }
	) => boolean;
};

function staticFile(
	dir: string,
	filename: string,
	contentType: string,
	extraHeaders?: Record<string, string>
) {
	return async () => {
		const file = Bun.file(resolve(dir, filename));
		if (!(await file.exists())) {
			return new Response("Not found", { status: 404 });
		}
		return new Response(file, {
			headers: {
				"Content-Type": contentType,
				"Set-Cookie": localAuthCookieHeader(),
				...createCorsHeaders(),
				...extraHeaders,
			},
		});
	};
}

function createCorsHeaders(req?: Request): Record<string, string> {
	const origin = req?.headers.get("origin") ?? null;
	const headers = { ...BASE_CORS_HEADERS };
	if (isTrustedLocalOrigin(origin)) {
		return {
			...headers,
			"Access-Control-Allow-Origin": origin!,
			Vary: "Origin",
		};
	}
	return headers;
}

function withCors(response: Response, req?: Request): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(createCorsHeaders(req))) {
		headers.set(key, value);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function addCorsToRoutes(
	routes: ReturnType<typeof buildApiRoutes>
): ReturnType<typeof buildApiRoutes> {
	return Object.fromEntries(
		Object.entries(routes).map(([path, methods]) => [
			path,
			Object.fromEntries(
				Object.entries(methods).map(([method, handler]) => {
					const routeHandler = handler as (req: Request) => Promise<Response>;
					return [
						method,
						async (req: Request) => {
							if (!isTrustedLocalRequest(req)) {
								return new Response("Forbidden", { status: 403 });
							}
							return withCors(await routeHandler(req), req);
						},
					];
				})
			),
		])
	) as unknown as ReturnType<typeof buildApiRoutes>;
}

async function hasViteBuild() {
	try {
		const entries = await readdir(distDir);
		return entries.some(
			(e) => e === "index.html" || e === "main.js" || e === "assets"
		);
	} catch {
		return false;
	}
}

async function serveRendererIndex(): Promise<Response | null> {
	const indexFile = Bun.file(resolve(distDir, "index.html"));
	if (await indexFile.exists()) {
		return new Response(indexFile, {
			headers: {
				"Content-Type": "text/html",
				"Cache-Control": "no-cache",
				"Set-Cookie": localAuthCookieHeader(),
			},
		});
	}

	const mainFile = Bun.file(resolve(distDir, "main.js"));
	if (!(await mainFile.exists())) return null;

	return new Response(
		[
			"<!doctype html>",
			'<html lang="en">',
			"<head>",
			'<meta charset="UTF-8" />',
			'<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
			"<title>inferay</title>",
			'<meta name="theme-color" content="#09090b" />',
			'<meta name="color-scheme" content="dark" />',
			"</head>",
			'<body><div id="root"></div><script type="module" src="/main.js"></script></body>',
			"</html>",
		].join(""),
		{
			headers: {
				"Content-Type": "text/html",
				"Cache-Control": "no-cache",
				"Set-Cookie": localAuthCookieHeader(),
			},
		}
	);
}

async function serveDistFile(pathname: string): Promise<Response | null> {
	const filePath = resolve(
		distDir,
		pathname.startsWith("/") ? pathname.slice(1) : pathname
	);
	if (!isWithinDirectory(filePath, distDir)) return null;
	const file = Bun.file(filePath);
	if (!(await file.exists())) return null;

	const ext = filePath.split(".").pop() || "";
	const types: Record<string, string> = {
		html: "text/html",
		js: "application/javascript",
		css: "text/css",
		json: "application/json",
		png: "image/png",
		jpg: "image/jpeg",
		svg: "image/svg+xml",
		woff2: "font/woff2",
		woff: "font/woff",
		ico: "image/x-icon",
		webp: "image/webp",
	};
	const contentType = types[ext] || "application/octet-stream";
	const cacheControl = pathname.startsWith("/assets/")
		? "public, max-age=31536000, immutable"
		: "no-cache";

	return new Response(file, {
		headers: {
			"Content-Type": contentType,
			"Cache-Control": cacheControl,
			...(contentType === "text/html"
				? { "Set-Cookie": localAuthCookieHeader() }
				: {}),
		},
	});
}

export function shutdownAppServices() {
	AgentService.destroyAll();
	ChatService.destroyAll();
	PidTracker.flush().catch(noop);
}

export function installShutdownHandlers() {
	if (g.__agent_gui_shutdown_handlers_installed) {
		return;
	}

	g.__agent_gui_shutdown_handlers_installed = true;
	const cleanShutdown = () => {
		shutdownAppServices();
		process.exit(0);
	};
	process.on("SIGTERM", cleanShutdown);
	process.on("SIGINT", cleanShutdown);
	process.on("SIGHUP", cleanShutdown);
}

function routeHandlerFor(
	routes: ReturnType<typeof buildApiRoutes>,
	pathname: string,
	method: string
): ((req: Request) => Promise<Response>) | null {
	return (
		(
			routes as unknown as Record<
				string,
				Record<string, (req: Request) => Promise<Response>>
			>
		)[pathname]?.[method] ?? null
	);
}

export async function handleAppHttpRequest(
	req: Request,
	server?: AppUpgradeServer,
	options?: {
		corsApiRoutes?: ReturnType<typeof buildApiRoutes>;
		viteBuildPresent?: boolean;
	}
): Promise<Response | undefined> {
	const url = new URL(req.url);
	const corsApiRoutes = options?.corsApiRoutes ?? addCorsToRoutes(apiRoutes);
	const viteBuildPresent = options?.viteBuildPresent ?? (await hasViteBuild());

	const appInfoHandler =
		url.pathname === "/logo.png"
			? staticFile(publicDir, "logo.png", "image/png")
			: url.pathname === "/app-icon.png"
				? staticFile(publicDir, "app-icon.png", "image/png")
				: url.pathname === "/background-city-rain.png"
					? staticFile(publicDir, "background-city-rain.png", "image/png")
					: url.pathname === "/background-nature-sanctuary.png"
						? staticFile(
								publicDir,
								"background-nature-sanctuary.png",
								"image/png"
							)
						: url.pathname === "/background-orbital-study.png"
							? staticFile(
									publicDir,
									"background-orbital-study.png",
									"image/png"
								)
							: url.pathname === "/inferay-vibespace.png"
								? staticFile(publicDir, "inferay-vibespace.png", "image/png")
								: null;
	if (appInfoHandler) return withCors(await appInfoHandler(), req);

	const routeHandler = routeHandlerFor(corsApiRoutes, url.pathname, req.method);
	if (routeHandler) return routeHandler(req);

	if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
		if (!isTrustedLocalRequest(req)) {
			return new Response("Forbidden", { status: 403 });
		}
		return new Response(null, {
			status: 204,
			headers: createCorsHeaders(req),
		});
	}

	if (url.pathname === "/ws") {
		if (!isTrustedLocalRequest(req)) {
			return new Response("Forbidden", { status: 403 });
		}
		const upgraded = server?.upgrade(req, {
			data: { subscriptions: new Set() },
		});
		if (upgraded) return undefined;
		return new Response("WebSocket upgrade failed", { status: 400 });
	}

	if (url.pathname.startsWith("/api/prompts/") && !isTrustedLocalRequest(req)) {
		return new Response("Forbidden", { status: 403 });
	}
	const promptResponse = handlePromptRequest(req);
	if (promptResponse) {
		return withCors(await promptResponse, req);
	}

	if (viteBuildPresent) {
		const distResponse = await serveDistFile(url.pathname);
		if (distResponse) return withCors(distResponse, req);

		if (!url.pathname.startsWith("/api/")) {
			const indexResponse = await serveRendererIndex();
			if (indexResponse) return withCors(indexResponse, req);
		}
	}

	return new Response("Not found", { status: 404 });
}

export async function startAppServer(port = 4001) {
	if (g.__agent_gui_server) {
		return g.__agent_gui_server;
	}

	const viteBuildPresent = await hasViteBuild();
	const corsApiRoutes = addCorsToRoutes(apiRoutes);

	const server = Bun.serve({
		port,
		hostname: "127.0.0.1",
		idleTimeout: 255,
		routes: {
			"/logo.png": staticFile(publicDir, "logo.png", "image/png"),
			"/app-icon.png": staticFile(publicDir, "app-icon.png", "image/png"),
			"/background-city-rain.png": staticFile(
				publicDir,
				"background-city-rain.png",
				"image/png"
			),
			"/background-nature-sanctuary.png": staticFile(
				publicDir,
				"background-nature-sanctuary.png",
				"image/png"
			),
			"/background-orbital-study.png": staticFile(
				publicDir,
				"background-orbital-study.png",
				"image/png"
			),
			"/inferay-vibespace.png": staticFile(
				publicDir,
				"inferay-vibespace.png",
				"image/png"
			),
			...corsApiRoutes,
			"/api/restart": {
				POST: async (req) => {
					if (!isTrustedLocalRequest(req)) {
						return new Response("Forbidden", { status: 403 });
					}
					setTimeout(() => process.exit(0), 50);
					return withCors(
						Response.json({ ok: true, message: "Restarting..." }),
						req
					);
				},
			},
		},
		websocket: websocketHandler,
		fetch(req, server) {
			return handleAppHttpRequest(req, server, {
				corsApiRoutes,
				viteBuildPresent,
			});
		},
	});

	g.__agent_gui_server = server;
	CheckpointService.load().catch((e) =>
		console.error("[Checkpoint] Failed to load:", e)
	);
	return server;
}
