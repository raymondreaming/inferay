import { useQuery } from "@octanejs/tanstack-query";
import { queryClient } from "../../../shared/lib/data.ts";
import { emptySkills, skillsQuery } from "../model/skill-library.ts";
export function useSkills(filter = "all", search = "") {
	const query = useQuery(skillsQuery(filter, search), queryClient);
	return {
		skills: query.data ?? emptySkills,
		loading: query.isPending,
		error: query.error?.message ?? "",
	};
}
