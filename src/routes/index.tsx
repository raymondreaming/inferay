import { createFileRoute, useNavigate } from "@octanejs/tanstack-router";
import { useEffect } from "octane";
import { ONBOARDING_DONE_STORAGE_KEY } from "../adapters/storage/keys.ts";
import { readStoredBoolean } from "../adapters/storage/stored-values.ts";
import { DEFAULT_APP_ROUTE } from "../app/navigation.tsx";

export const Route = createFileRoute("/")({ component: IndexRoute });

function IndexRoute() {
	const navigate = useNavigate();
	useEffect(() => {
		const destination = readStoredBoolean(ONBOARDING_DONE_STORAGE_KEY)
			? DEFAULT_APP_ROUTE
			: "/onboarding";
		navigate({ to: destination, replace: true });
	}, [navigate]);
	return null;
}
