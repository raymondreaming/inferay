import type { DiffHunk, SequentialEdit } from "@conversation/model/editDiff.ts";
import { prepareNativeEditDiff } from "@conversation/services/conversationApi.ts";
import { useBackgroundQuery as useQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import type { Accessor } from "solid-js";

export type {
	DiffHunk,
	GitDiffLine,
	LineTextSegment,
	SequentialEdit,
} from "@conversation/model/editDiff.ts";

const EMPTY_HUNKS: DiffHunk[] = [];
export function useNativeEditDiff(
	_before: Accessor<string>,
	_after: Accessor<string>,
	_streaming: Accessor<boolean> = () => false,
	_edits: Accessor<SequentialEdit[] | undefined> = () => undefined,
) {
	const query = useQuery(
		() => {
			const _streamingValue = _streaming();
			const input = _streamingValue
				? null
				: { before: _before(), after: _after(), edits: _edits() };
			return {
				queryKey: input
					? ["native-edit-diff", input.before, input.after, input.edits ?? null]
					: ["native-edit-diff", "disabled"],
				queryFn: async ({ signal }: { signal: AbortSignal }) => {
					if (!input) return EMPTY_HUNKS;
					return prepareNativeEditDiff(input, signal);
				},
				enabled: !_streamingValue,
				staleTime: Infinity,
				// Virtual rows remount on scroll-back. Reuse their prepared result
				// instead of collapsing to a placeholder and requesting it again.
				gcTime: 5 * 60_000,
				retry: false,
			};
		},
		() => queryClient,
	);
	return {
		get hunks() {
			const _streamingValue2 = _streaming();
			return _streamingValue2 ? EMPTY_HUNKS : (query.data ?? EMPTY_HUNKS);
		},
		get loading() {
			const _streamingValue2 = _streaming();
			return !_streamingValue2 && query.isPending;
		},
		get error() {
			const _streamingValue2 = _streaming();
			return _streamingValue2 ? undefined : query.error?.message;
		},
	};
}
