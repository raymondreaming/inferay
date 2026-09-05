import { useQuery } from "@octanejs/tanstack-query";
import { useEffect, useRef, useState } from "octane";
import { sendJson } from "../../adapters/backend/http.ts";
import type { PreparedMarkdown } from "../lib/markdown.ts";
import { queryClient } from "../lib/query-client.ts";

/** Query lifecycle only: native code owns all Markdown interpretation. */
export function useNativeMarkdown(
	text: string,
	streaming = false,
	chat = false,
) {
	const latest = useRef(text);
	latest.current = text;
	const [sample, setSample] = useState(text);
	const input = streaming && text.startsWith(sample) ? sample : text;
	const query = useQuery(
		{
			queryKey: ["native-markdown", 1, chat, streaming, input],
			queryFn: async ({ signal }: { signal: AbortSignal }) => {
				const response = await sendJson(
					"/api/native/markdown",
					{
						text: input,
						streaming,
						chat,
					},
					{ signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) },
				);
				if (!response.ok) {
					const failure = await response.json().catch(() => null);
					throw new Error(
						failure?.error ?? `Markdown request failed (${response.status})`,
					);
				}
				const prepared: PreparedMarkdown = await response.json();
				if (prepared.version !== 1 || !Array.isArray(prepared.blocks)) {
					throw new Error("Unsupported Markdown response");
				}
				return { ...prepared, text: input, chat, streaming };
			},
			placeholderData: (previous) =>
				previous?.chat === chat &&
				(previous.text === text ||
					(streaming && previous.streaming && text.startsWith(previous.text)))
					? previous
					: undefined,
			staleTime: Infinity,
			gcTime: 0,
			retry: false,
		},
		queryClient,
	);
	// Sample growing text at most once per 80ms and only after the previous
	// request settles. Slow native work cannot be continually aborted by tokens.
	// Resets and final messages bypass sampling through `input` above.
	const needsSample = sample !== text;
	useEffect(() => {
		if (!streaming || !needsSample || query.isFetching) return;
		const timer = setTimeout(() => setSample(latest.current), 80);
		return () => clearTimeout(timer);
	}, [sample, streaming, needsSample, query.isFetching]);
	return {
		blocks: query.data?.blocks ?? [],
		loading: query.isPending,
		error: query.error?.message,
	};
}
