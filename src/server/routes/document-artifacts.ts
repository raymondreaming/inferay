import { tryRoute } from "../../lib/route-helpers.ts";
import {
	loadDocumentArtifacts,
	saveDocumentArtifacts,
} from "../services/document-artifacts.ts";

export function documentArtifactRoutes() {
	return {
		"/api/document-artifacts": {
			GET: tryRoute(async () => Response.json(await loadDocumentArtifacts())),
			PUT: tryRoute(async (req) =>
				Response.json(await saveDocumentArtifacts(await req.json()))
			),
		},
	};
}
