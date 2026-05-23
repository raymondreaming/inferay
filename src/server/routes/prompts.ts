import type { Prompt } from "../../features/prompts/types.ts";
import { tryRoute } from "../../lib/route-helpers.ts";
import {
	createPrompt,
	deletePrompt,
	incrementPromptUsage,
	listPromptsByUsage,
	type PromptServiceResult,
	updatePrompt,
} from "../services/prompts.ts";

function resultResponse<T>(result: PromptServiceResult<T>): Response {
	return result.ok
		? Response.json(result.value)
		: Response.json({ error: result.error }, { status: result.status });
}

export function promptRoutes() {
	return {
		"/api/prompts": {
			GET: tryRoute(async () => Response.json(await listPromptsByUsage())),
			POST: tryRoute(async (req) =>
				resultResponse(
					await createPrompt((await req.json()) as Partial<Prompt>)
				)
			),
		},
	};
}

// These need to be handled in the fetch handler since Bun routes don't support path params.
export function handlePromptRequest(
	req: Request
): Response | Promise<Response> | null {
	const url = new URL(req.url);
	const match = url.pathname.match(/^\/api\/prompts\/([^/]+)(\/usage)?$/);
	if (!match) return null;

	const id = match[1]!;
	const isUsage = !!match[2];

	if (isUsage && req.method === "POST") {
		return incrementPromptUsage(id).then(resultResponse);
	}
	if (req.method === "PUT") {
		return req
			.json()
			.then((body) => updatePrompt(id, body as Partial<Prompt>))
			.then(resultResponse);
	}
	if (req.method === "DELETE") {
		return deletePrompt(id).then(resultResponse);
	}
	return null;
}
