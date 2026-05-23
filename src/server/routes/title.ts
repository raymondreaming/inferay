import { badRequest, tryRoute } from "../../lib/route-helpers.ts";
import { resolveAllowedLocalPath } from "../security.ts";
import { generateCommitMessage, generateTitle } from "../services/title.ts";

export function titleRoutes() {
	return {
		"/api/generate-title": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { message?: string };
				if (typeof body.message !== "string" || !body.message.trim()) {
					return badRequest("Missing message");
				}
				const title = await generateTitle(body.message);
				return Response.json({ title });
			}),
		},
		"/api/git/generate-commit-message": {
			POST: tryRoute(async (req) => {
				const body = (await req.json()) as { cwd?: string };
				if (typeof body.cwd !== "string" || !body.cwd.trim()) {
					return badRequest("Missing cwd");
				}
				const cwd = resolveAllowedLocalPath(body.cwd);
				if (!cwd) {
					return Response.json(
						{ error: "Path is outside allowed local roots" },
						{ status: 403 }
					);
				}
				const message = await generateCommitMessage(cwd);
				if (!message) {
					return Response.json(
						{
							error: "No staged changes or Claude is unavailable",
						},
						{ status: 400 }
					);
				}
				return Response.json({ message });
			}),
		},
	};
}
