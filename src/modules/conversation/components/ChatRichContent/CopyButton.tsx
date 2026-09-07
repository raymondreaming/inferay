import * as stylex from "@stylexjs/stylex";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onSettled,
} from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconCheck, IconCopy } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function useCopyText(
	_text: Accessor<string>,
	_clearOnError: Accessor<boolean> = () => false,
) {
	const [copied, setCopied] = createSignal(false);
	const copiedTimerRef = {
		current: null,
	} as {
		current: ReturnType<typeof setTimeout> | null;
	};
	onSettled(() => () => {
		if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
	});
	const handleCopy = () => {
		navigator.clipboard
			.writeText(_text())
			.then(() => {
				setCopied(true);
				if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
				copiedTimerRef.current = setTimeout(() => {
					copiedTimerRef.current = null;
					setCopied(false);
				}, 1500);
			})
			.catch(() => {
				if (_clearOnError()) setCopied(false);
			});
	};
	return {
		get copied() {
			return copied();
		},
		get handleCopy() {
			return handleCopy;
		},
	};
}
export function CopyButton(_props: { text: string; class?: string }) {
	const _source = useCopyText(() => _props.text);
	const copyButtonProps = createMemo(() =>
		stylex.attrs(
			styles.copyButton,
			_source.copied ? styles.copyButtonCopied : null,
		),
	);
	return (
		<button
			type="button"
			onClick={_source.handleCopy}
			{...copyButtonProps()}
			class={`${copyButtonProps().class ?? ""} ${_props.class ?? ""}`}
			title={_source.copied ? "Copied!" : "Copy"}
		>
			{_source.copied ? (
				<IconCheck size={iconSize.sm} />
			) : (
				<IconCopy size={iconSize.sm} />
			)}
		</button>
	);
}
