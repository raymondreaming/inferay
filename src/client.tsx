import { hydrateStart, StartClient } from "@octanejs/tanstack-start/client";
import { hydrateRoot, initializeHydrationEventCapture } from "octane";
import {
	hydrateStoredValues,
	ONBOARDING_DONE_STORAGE_KEY,
	readStoredBoolean,
} from "./adapters/storage/stored-values.ts";
import {
	applyAppBackgroundSurfaces,
	applyAppFont,
	applyAppTheme,
	loadAppBackgroundSettings,
	loadAppFontId,
	loadAppThemeId,
} from "./app/model/appearance.ts";
import { initializeAgentCatalog } from "./modules/agents/model/agents.ts";
import { preloadSkills } from "./modules/skills/hooks/useSkills.tsx";
import { initializeAgentState } from "./modules/workspace/hooks/useWorkspaceState.tsx";
import { restoreSyntaxTheme } from "./shared/hooks/useSyntaxHighlight.tsx";

let restoreStartupContent: (() => void) | undefined;
while (true) {
	try {
		await hydrateStoredValues();
		await initializeAgentCatalog();
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
			"Saved application state could not be loaded. Your saved data has not been replaced. ";
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
const entryPath = readStoredBoolean(ONBOARDING_DONE_STORAGE_KEY)
	? "/"
	: "/onboarding";
if (
	(initialPath === "/" || initialPath === "/onboarding") &&
	initialPath !== entryPath
) {
	window.history.replaceState(window.history.state, "", entryPath);
}

applyAppTheme(loadAppThemeId());
applyAppFont(loadAppFontId());
applyAppBackgroundSurfaces(loadAppBackgroundSettings().mode);
restoreSyntaxTheme();

const idle =
	window.requestIdleCallback ??
	((callback: IdleRequestCallback) => window.setTimeout(callback, 150));
idle(() => void preloadSkills());

initializeHydrationEventCapture();

const router = await hydrateStart();
const container = document.getElementById("__app");
if (!container) throw new Error("Missing application root.");
hydrateRoot(container, StartClient, { router });
