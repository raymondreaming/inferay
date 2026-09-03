import { createFileRoute } from "@octanejs/tanstack-router";
import { OnboardingRoute } from "../modules/onboarding/components/OnboardingPage.tsx";

export const Route = createFileRoute("/onboarding")({
	component: OnboardingRoute,
});
