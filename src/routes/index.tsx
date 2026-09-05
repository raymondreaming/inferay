import { createFileRoute } from "@octanejs/tanstack-router";

import { IndexRoute } from "../app/components/IndexRoute/index.tsx";

export const Route = createFileRoute("/")({ component: IndexRoute });
