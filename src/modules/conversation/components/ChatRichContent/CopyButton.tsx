import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useRef, useState } from "octane";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconCheck, IconCopy } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

export function useCopyText(text: string, clearOnError = false) {
	const [copied, setCopied] = useState(false);
	const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
		},
		[],
	);

	const handleCopy = useCallback(() => {
		navigator.clipboard
			.writeText(text)
			.then(() => {
				setCopied(true);
				if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
				copiedTimerRef.current = setTimeout(() => {
					copiedTimerRef.current = null;
					setCopied(false);
				}, 1500);
			})
			.catch(() => {
				if (clearOnError) setCopied(false);
			});
	}, [text, clearOnError]);
	return { copied, handleCopy };
}

export function CopyButton({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	const { copied, handleCopy } = useCopyText(text);
	const copyButtonProps = stylex.props(
		styles.copyButton,
		copied ? styles.copyButtonCopied : null,
	);

	return (
		<button
			type="button"
			onClick={handleCopy}
			{...copyButtonProps}
			className={`${copyButtonProps.className ?? ""} ${className ?? ""}`}
			title={copied ? "Copied!" : "Copy"}
		>
			{copied ? (
				<IconCheck size={iconSize.sm} />
			) : (
				<IconCopy size={iconSize.sm} />
			)}
		</button>
	);
}
