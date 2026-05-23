import { badRequest, tryRoute } from "../../lib/route-helpers.ts";
import { resolveAllowedLocalPath } from "../security.ts";
import { resolveNativeCoreBinary } from "../services/native-core.ts";
import { computeNativeDiff } from "../services/native-diff.ts";
import { openNativePath } from "../services/native-open.ts";

export function nativeRoutes() {
	return {
		"/api/native/diff": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as {
					before?: string;
					after?: string;
				};
				if (typeof body.before !== "string" || typeof body.after !== "string") {
					return badRequest("Missing before/after diff payload");
				}

				const diff = await computeNativeDiff(body.before, body.after);
				if (!diff) {
					return Response.json(
						{
							ok: false,
							error: "Native diff unavailable",
							available: Boolean(resolveNativeCoreBinary()),
						},
						{ status: 503 }
					);
				}

				return Response.json({ ok: true, diff });
			}),
		},
		"/api/native/open-path": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as {
					path?: string;
					reveal?: boolean;
				};
				if (typeof body.path !== "string" || !body.path.trim()) {
					return badRequest("Missing path");
				}
				const resolvedPath = resolveAllowedLocalPath(body.path);
				if (!resolvedPath) {
					return Response.json({ error: "Access denied" }, { status: 403 });
				}
				const ok = await openNativePath(resolvedPath, Boolean(body.reveal));
				return Response.json({ ok });
			}),
		},
	};
}
