import { tryRoute } from "../../lib/route-helpers.ts";
import {
	applyClientStorageEntries,
	loadClientStorageEntries,
	normalizeEntries,
} from "../services/client-storage.ts";

export function clientStorageRoutes() {
	const writeEntries = tryRoute(async (req) => {
		const body = await req.json();
		const entries = normalizeEntries(body?.entries);
		await applyClientStorageEntries(entries);
		return Response.json({ ok: true });
	});

	return {
		"/api/client-storage": {
			GET: tryRoute(async () => {
				const entries = await loadClientStorageEntries();
				return Response.json({ entries });
			}),
			PUT: writeEntries,
			POST: writeEntries,
		},
	};
}
