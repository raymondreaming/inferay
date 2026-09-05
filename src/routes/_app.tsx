import { createFileRoute } from "@octanejs/tanstack-router";

import { AppLayout } from "../app/components/AppLayout/index.tsx";

export const Route = createFileRoute("/_app")({ component: AppLayout });
