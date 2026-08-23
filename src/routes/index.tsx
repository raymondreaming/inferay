import { createFileRoute, useNavigate } from "@octanejs/tanstack-router";
import { useEffect } from "octane";
import { DEFAULT_APP_ROUTE } from "../lib/app-navigation.tsx";
import { ONBOARDING_DONE_STORAGE_KEY } from "../lib/client-storage-keys.ts";
import { readStoredBoolean } from "../lib/stored-json.ts";

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
