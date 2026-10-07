import type {
	ProjectProposalDecision,
	ProjectProposalRequest,
	ProjectProposalView,
} from "@contracts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { createMemo, createSignal } from "solid-js";
import { projectProposal } from "../services/projectsApi.ts";
import { refreshProjects } from "./useProjects.tsx";

export function useProjectProposal(
	input: () => Omit<ProjectProposalRequest, "decision" | "editedCommand">,
) {
	const request = createMemo(input);
	const resource = useQueryResource<ProjectProposalView | null>(
		() => {
			const value = request();
			return (signal) => projectProposal({ ...value, decision: null }, signal);
		},
		() => null,
		() => ({
			queryKey: ["project-proposal", request().messageId, request().command],
		}),
	);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	const loading = () => !resource.loaded || resource.loading;
	const decide = async (
		decision: ProjectProposalDecision,
		editedCommand?: ProjectProposalRequest["editedCommand"],
	) => {
		if (busy() || loading() || resource.data?.status !== "pending") return;
		setBusy(true);
		setError("");
		try {
			const view = await projectProposal({
				...request(),
				decision,
				editedCommand,
			});
			resource.setData(view);
			if (view.status === "saved") {
				try {
					await refreshProjects();
				} catch (error) {
					setError(
						"Saved, but the project view could not refresh: " + String(error),
					);
				}
			}
			return view;
		} catch (error) {
			setError(String(error));
			return undefined;
		} finally {
			setBusy(false);
		}
	};
	return {
		view: () => resource.data,
		loading,
		busy,
		error: () => error() || (resource.error ? String(resource.error) : ""),
		decide,
	};
}
