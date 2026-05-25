import {
	ApplicationMenu,
	BrowserWindow,
	defineElectrobunRPC,
} from "electrobun/bun";
import { shutdownAppServices, startAppServer } from "./server/app-server.ts";
import { PidTracker } from "./server/services/pid-tracker.ts";

type WindowControlsRPC = {
	bun: {
		requests: {
			closeWindow: { params: undefined; response: undefined };
			minimizeWindow: { params: undefined; response: undefined };
			toggleMaximizeWindow: {
				params: undefined;
				response: { maximized: boolean };
			};
		};
		messages: Record<string, never>;
	};
	webview: {
		requests: Record<string, never>;
		messages: Record<string, never>;
	};
};

const PREFERRED_SERVER_PORT = Number(
	process.env.TERMINAL_GUI_SERVER_PORT || "4001"
);

ApplicationMenu.setApplicationMenu([
	{
		submenu: [{ label: "Quit", role: "quit" }],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "pasteAndMatchStyle" },
			{ role: "delete" },
			{ role: "selectAll" },
		],
	},
]);

let server: Awaited<ReturnType<typeof startAppServer>> | null = null;
let serverPort = PREFERRED_SERVER_PORT;

for (let attempt = 0; attempt < 10; attempt++) {
	try {
		serverPort = PREFERRED_SERVER_PORT + attempt;
		server = await startAppServer(serverPort);
		break;
	} catch (error) {
		if (
			error instanceof Error &&
			!("code" in error
				? (error as Error & { code?: string }).code === "EADDRINUSE"
				: false)
		) {
			throw error;
		}
	}
}

if (!server) {
	throw new Error("Failed to start desktop server on ports 4001-4010.");
}

await PidTracker.cleanupOrphans();

const rendererUrl =
	process.env.TERMINAL_GUI_RENDERER_URL || `http://127.0.0.1:${serverPort}`;

let mainWindow: BrowserWindow | null = null;

const windowRpc = defineElectrobunRPC<WindowControlsRPC>("bun", {
	handlers: {
		requests: {
			closeWindow() {
				mainWindow?.close();
				return undefined;
			},
			minimizeWindow() {
				mainWindow?.minimize();
				return undefined;
			},
			toggleMaximizeWindow() {
				if (!mainWindow) {
					return { maximized: false };
				}

				const fs = mainWindow.isFullScreen();
				mainWindow.setFullScreen(!fs);
				return { maximized: !fs };
			},
		},
	},
});

mainWindow = new BrowserWindow({
	title: "inferay",
	url: rendererUrl,
	rpc: windowRpc,
	titleBarStyle: "hiddenInset",
	trafficLightOffset: { x: 56, y: 13 },
	frame: {
		x: 120,
		y: 80,
		width: 1440,
		height: 920,
	},
});

mainWindow.on("close", shutdownAppServices);

process.on("SIGTERM", shutdownAppServices);
process.on("SIGINT", shutdownAppServices);
