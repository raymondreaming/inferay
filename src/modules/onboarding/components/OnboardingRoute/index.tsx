import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createEffect, onSettled } from "solid-js";
import { APP_REGION_DRAG_CLASS } from "../../../../app/hooks/useAppAppearance.tsx";
import {
	ONBOARDING_DONE_STORAGE_KEY,
	readStoredBoolean,
} from "../../../../shared/lib/native.tsx";
import { OnboardingPage } from "../OnboardingPage/index.tsx";
import { routeStyles } from "./styles.ts";
export function OnboardingRoute() {
	const navigate = useNavigate();
	onSettled(() => {
		if (!readStoredBoolean(ONBOARDING_DONE_STORAGE_KEY)) return;
		navigate("/", {
			replace: true,
		});
	});
	return (
		<div {...stylex.attrs(routeStyles.shell)}>
			<div
				{...stylex.attrs(routeStyles.windowSpacer)}
				class={`${APP_REGION_DRAG_CLASS} ${stylex.attrs(routeStyles.windowSpacer).class ?? ""}`}
			/>
			<div {...stylex.attrs(routeStyles.content)}>
				<OnboardingPage />
			</div>
		</div>
	);
}
