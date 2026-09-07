import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	untrack,
} from "solid-js";
import type { PreparedMarkdown } from "../../../build/presentation/contracts/PreparedMarkdown.ts";
import { queryClient } from "../lib/dom.tsx";
import { sendJson } from "../lib/native.tsx";
import { useBackgroundQuery as useQuery } from "./useQueryResource.tsx";

/** Query lifecycle only: native code owns all Markdown interpretation. */
export function useNativeMarkdown(
	_text: Accessor<string>,
	_streaming: Accessor<boolean> = () => false,
	_chat: Accessor<boolean> = () => false,
) {
	const [sample, setSample] = createSignal(untrack(_text));
	const input = createMemo(() => {
		const _textValue = _text(),
			_sampleValue = sample();
		return _streaming() && _textValue.startsWith(_sampleValue)
			? _sampleValue
			: _textValue;
	});
	const query = useQuery(
		() => {
			const _inputValue = input(),
				_streamingValue = _streaming(),
				_chatValue = _chat();
			return {
				queryKey: [
					"native-markdown",
					1,
					_chatValue,
					_streamingValue,
					_inputValue,
				],
				queryFn: async ({ signal }: { signal: AbortSignal }) => {
					const response = await sendJson(
						"/api/native/markdown",
						{
							text: _inputValue,
							streaming: _streamingValue,
							chat: _chatValue,
						},
						{
							signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
						},
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
					return {
						...prepared,
						text: _inputValue,
						chat: _chatValue,
						streaming: _streamingValue,
					};
				},
				placeholderData: (previous) => {
					const _textValue2 = _inputValue;
					return previous?.chat === _chatValue &&
						(previous.text === _textValue2 ||
							(previous.streaming && _textValue2.startsWith(previous.text)))
						? previous
						: undefined;
				},
				staleTime: Infinity,
				gcTime: _streamingValue ? 0 : 60_000,
				retry: false,
			};
		},
		() => queryClient,
	);
	// Sample growing text at most once per 80ms and only after the previous
	// request settles. Slow native work cannot be continually aborted by tokens.
	// Resets and final messages bypass sampling through `input` above.
	const needsSample = createMemo(() => sample() !== _text());
	createEffect(
		() => [sample(), _streaming(), needsSample(), query.isFetching] as const,
		([, streaming, needsUpdate, fetching]) => {
			if (!streaming || !needsUpdate || fetching) return;
			const timer = setTimeout(() => setSample(_text()), 80);
			return () => clearTimeout(timer);
		},
	);
	return {
		get blocks() {
			return query.data?.blocks ?? [];
		},
		get loading() {
			return query.isPending;
		},
		get error() {
			return query.error?.message;
		},
	};
}
