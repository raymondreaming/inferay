import { hydrateStart, StartClient } from "@octanejs/tanstack-start/client";
import { hydrateRoot, initializeHydrationEventCapture } from "octane";
import { getServerOrigin, resolveServerUrl } from "./adapters/backend/http.ts";
import {
	AGENT_MAIN_VIEW_STORAGE_KEY,
	ONBOARDING_DONE_STORAGE_KEY,
} from "./adapters/storage/keys.ts";
import {
	readStoredBoolean,
	writeStoredValue,
} from "./adapters/storage/stored-values.ts";
import { hydrateStoredValues } from "./adapters/storage/sync.ts";
import {
	applyAppBackgroundSurfaces,
	applyAppTheme,
	loadAppBackgroundSettings,
	loadAppThemeId,
} from "./app/model/appearance.ts";
import { applyAppFont, loadAppFontId } from "./app/model/font.ts";
import {
	DEFAULT_AGENT_MAIN_VIEW,
	DEFAULT_APP_ROUTE,
} from "./app/model/navigation.tsx";
import { initializeAgentCatalog } from "./modules/agents/model/agents.ts";
import { preloadSkills } from "./modules/skills/hooks/useSkills.tsx";
import { initializeAgentState } from "./modules/workspace/model/workspace-model.ts";

function routeLocalRequestsToDesktopServer() {
	if (window.location.origin === getServerOrigin()) return;

	const originalFetch = window.fetch.bind(window);
	window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		if (typeof input === "string" && input.startsWith("/")) {
			return originalFetch(resolveServerUrl(input), init);
		}
		if (input instanceof URL && input.pathname.startsWith("/")) {
			return originalFetch(
				resolveServerUrl(`${input.pathname}${input.search}`),
				init,
			);
		}
		if (input instanceof Request) {
			const url = new URL(input.url, window.location.origin);
			if (url.pathname.startsWith("/")) {
				return originalFetch(
					new Request(resolveServerUrl(`${url.pathname}${url.search}`), input),
					init,
				);
			}
		}
		return originalFetch(input, init);
	}) as typeof window.fetch;
}

routeLocalRequestsToDesktopServer();
await hydrateStoredValues();
await initializeAgentCatalog();
let restoreStartupContent: (() => void) | undefined;
while (true) {
	try {
		await initializeAgentState();
		restoreStartupContent?.();
		break;
	} catch {
		const container = document.getElementById("__app");
		if (container && !restoreStartupContent) {
			const content = Array.from(container.childNodes);
			restoreStartupContent = () => container.replaceChildren(...content);
		}
		const notice = document.createElement("div");
		notice.setAttribute("role", "alert");
		notice.textContent =
			"Saved workspaces could not be loaded. Your saved data has not been replaced. ";
		const retry = document.createElement("button");
		retry.textContent = "Retry";
		notice.append(retry);
		container?.replaceChildren(notice);
		await new Promise<void>((resolve) =>
			retry.addEventListener("click", () => resolve(), { once: true }),
		);
	}
}

// The desktop host uses a fresh loopback origin on each launch, so the durable
// onboarding value is restored from the native store immediately above. Move
// away from a prerendered entry route before TanStack hydrates that stale URL.
const initialPath = window.location.pathname.replace(/\/+$/, "") || "/";
if (
	readStoredBoolean(ONBOARDING_DONE_STORAGE_KEY) &&
	(initialPath === "/" || initialPath === "/onboarding")
) {
	window.history.replaceState(window.history.state, "", DEFAULT_APP_ROUTE);
}

writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, DEFAULT_AGENT_MAIN_VIEW);
applyAppTheme(loadAppThemeId());
applyAppFont(loadAppFontId());
applyAppBackgroundSurfaces(loadAppBackgroundSettings().mode);

const idle =
	window.requestIdleCallback ??
	((callback: IdleRequestCallback) => window.setTimeout(callback, 150));
idle(() => void preloadSkills());

initializeHydrationEventCapture();

const router = await hydrateStart();
const container = document.getElementById("__app");
if (!container) throw new Error("Missing application root.");
hydrateRoot(container, StartClient, { router });
