import { render } from "@solidjs/web";
import { RootComponent } from "./app/components/RootComponent/index.tsx";
import {
	applyAppBackgroundSurfaces,
	applyAppFont,
	applyAppTheme,
	loadAppBackgroundSettings,
	loadAppFontId,
	loadAppThemeId,
} from "./app/hooks/useAppAppearance.tsx";
import { preloadSkills } from "./modules/skills/hooks/useSkills.tsx";
import { initializeAgentState } from "./modules/workspace/hooks/useWorkspaceState.tsx";
import { restoreSyntaxTheme } from "./shared/hooks/useSyntaxHighlight.tsx";
import {
	hydrateStoredValues,
	initializeAgentCatalog,
} from "./shared/lib/native.tsx";

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
			retry.addEventListener("click", () => resolve(), {
				once: true,
			}),
		);
	}
}

// The workspace is the app's only entry route, including restored legacy URLs.
if (window.location.pathname !== "/") {
	window.history.replaceState(
		window.history.state,
		"",
		`/${window.location.search}${window.location.hash}`,
	);
}
applyAppTheme(loadAppThemeId());
applyAppFont(loadAppFontId());
applyAppBackgroundSurfaces(loadAppBackgroundSettings().mode);
restoreSyntaxTheme();
const idle =
	window.requestIdleCallback ??
	((callback: IdleRequestCallback) => window.setTimeout(callback, 150));
idle(() => void preloadSkills());
const container = document.getElementById("__app");
if (!container) throw new Error("Missing application root.");
render(() => <RootComponent />, container);
