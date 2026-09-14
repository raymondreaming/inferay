import type { PreparedEditDiff, SequentialEdit } from "@contracts";
import { prepareNativeEditDiff } from "@conversation/services/conversationApi.ts";
import { useBackgroundQuery as useQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import type { Accessor } from "solid-js";

const EMPTY_DIFF: PreparedEditDiff = {
	lines: [],
	lineCount: 0,
	contentWidthChars: 34,
	virtualized: false,
	hasChanges: false,
};
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
					if (!input) return EMPTY_DIFF;
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
		get prepared() {
			return _streaming() ? EMPTY_DIFF : (query.data ?? EMPTY_DIFF);
		},
		get loading() {
			return !_streaming() && query.isPending;
		},
		get error() {
			return _streaming() ? undefined : query.error?.message;
		},
	};
}
