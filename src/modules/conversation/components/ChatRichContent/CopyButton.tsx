import { iconSize } from "@design-system/styles.stylex.ts";
import { IconCheck, IconCopy } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { type Accessor, createSignal, onSettled } from "solid-js";
import { styles } from "./styles.ts";
export function useCopyText(
	_text: Accessor<string>,
	_clearOnError: Accessor<boolean> = () => false,
) {
	const [copied, setCopied] = createSignal(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	onSettled(() => () => {
		if (copiedTimer) clearTimeout(copiedTimer);
	});
	const handleCopy = () => {
		navigator.clipboard
			.writeText(_text())
			.then(() => {
				setCopied(true);
				if (copiedTimer) clearTimeout(copiedTimer);
				copiedTimer = setTimeout(() => {
					copiedTimer = undefined;
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
		handleCopy,
	};
}
export function CopyButton(_props: { text: string }) {
	const _source = useCopyText(() => _props.text);
	return (
		<button
			type="button"
			onClick={_source.handleCopy}
			{...stylex.attrs(
				styles.copyButton,
				_source.copied && styles.copyButtonCopied,
			)}
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
