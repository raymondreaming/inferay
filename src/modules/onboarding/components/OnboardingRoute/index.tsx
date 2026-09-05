import * as stylex from "@octanejs/stylex";
import { useNavigate } from "@octanejs/tanstack-router";
import { useEffect } from "octane";
import { ONBOARDING_DONE_STORAGE_KEY } from "../../../../adapters/storage/keys.ts";
import { readStoredBoolean } from "../../../../adapters/storage/stored-values.ts";
import { APP_REGION_DRAG_CLASS } from "../../../../app/model/appearance.ts";
import { DEFAULT_APP_ROUTE } from "../../../../app/model/navigation.tsx";
import { OnboardingPage } from "../OnboardingPage/index.tsx";
import { routeStyles } from "./styles.ts";

export function OnboardingRoute() {
	const navigate = useNavigate();

	useEffect(() => {
		if (!readStoredBoolean(ONBOARDING_DONE_STORAGE_KEY)) return;
		navigate({ to: DEFAULT_APP_ROUTE, replace: true });
	}, [navigate]);

	return (
		<div {...stylex.props(routeStyles.shell)}>
			<div
				{...stylex.props(routeStyles.windowSpacer)}
				className={`${APP_REGION_DRAG_CLASS} ${stylex.props(routeStyles.windowSpacer).className ?? ""}`}
			/>
			<div {...stylex.props(routeStyles.content)}>
				<OnboardingPage />
			</div>
		</div>
	);
}
