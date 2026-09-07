import type { Accessor } from "solid-js";
import { useBackgroundQuery as useQuery } from "../../../shared/hooks/useQueryResource.tsx";
import { queryClient } from "../../../shared/lib/dom.tsx";
import { sendJson } from "../../../shared/lib/native.tsx";
export type LineTextSegment = {
	text: string;
	changed: boolean;
};
export type GitDiffLine = {
	type: "context" | "removed" | "added";
	text: string;
	oldLineNum?: number;
	newLineNum?: number;
	segments?: LineTextSegment[];
};
export type DiffHunk = {
	lines: GitDiffLine[];
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
};
export type SequentialEdit = {
	old_string: string;
	new_string: string;
};
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
			return {
				queryKey: _streamingValue
					? ["native-edit-diff", "disabled"]
					: ["native-edit-diff", _before(), _after(), _edits() ?? null],
				queryFn: async ({ signal }: { signal: AbortSignal }) => {
					const response = await sendJson(
						"/api/native/diff",
						{
							before: _before(),
							after: _after(),
							edits: _edits(),
						},
						{
							signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
						},
					);
					if (!response.ok) {
						const failure = await response.json().catch(() => null);
						throw new Error(
							failure?.error ?? `Diff request failed (${response.status})`,
						);
					}
					const result: {
						prepared: {
							hunks: DiffHunk[];
						};
					} = await response.json();
					return result.prepared.hunks;
				},
				enabled: !_streamingValue,
				staleTime: Infinity,
				// Large inputs/results live only while observed; the query owner handles
				// in-flight sharing and cancellation without a second cache or subscribers.
				gcTime: 0,
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
