import { useQuery } from "@octanejs/tanstack-query";
import { sendJson } from "../../../adapters/backend/http.ts";
import { queryClient } from "../../../shared/lib/query-client.ts";

export type LineTextSegment = { text: string; changed: boolean };
export type DiffLine = {
	type: "context" | "removed" | "added";
	text: string;
	oldLineNum?: number;
	newLineNum?: number;
	segments?: LineTextSegment[];
};
export type DiffHunk = {
	lines: DiffLine[];
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
};
export type SequentialEdit = { old_string: string; new_string: string };
const EMPTY_HUNKS: DiffHunk[] = [];

export function useNativeEditDiff(
	before: string,
	after: string,
	streaming = false,
	edits?: SequentialEdit[],
) {
	const query = useQuery(
		{
			queryKey: streaming
				? ["native-edit-diff", "disabled"]
				: ["native-edit-diff", before, after, edits ?? null],
			queryFn: async ({ signal }: { signal: AbortSignal }) => {
				const response = await sendJson(
					"/api/native/diff",
					{ before, after, edits },
					{ signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) },
				);
				if (!response.ok) {
					const failure = await response.json().catch(() => null);
					throw new Error(
						failure?.error ?? `Diff request failed (${response.status})`,
					);
				}
				const result: { prepared: { hunks: DiffHunk[] } } =
					await response.json();
				return result.prepared.hunks;
			},
			enabled: !streaming,
			staleTime: Infinity,
			// Large inputs/results live only while observed; the query owner handles
			// in-flight sharing and cancellation without a second cache or subscribers.
			gcTime: 0,
			retry: false,
		},
		queryClient,
	);
	return {
		hunks: streaming ? EMPTY_HUNKS : (query.data ?? EMPTY_HUNKS),
		loading: !streaming && query.isPending,
		error: streaming ? undefined : query.error?.message,
	};
}
