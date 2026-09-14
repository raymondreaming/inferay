import { useNearViewport } from "@shared/hooks/useNearViewport.tsx";
import { assignRef, domStyle } from "@shared/lib/dom.tsx";
import { useNativeEditDiff } from "../../hooks/useNativeEditDiff.tsx";
import { EditDiffCard } from "./EditDiffCard.tsx";
import * as inlineStyles from "./styles.ts";
export function MiniEditDiff(_props: {
	oldStr: string;
	newStr: string;
	filePath: string;
	isStreaming?: boolean;
}) {
	const _source = useNearViewport();
	const _source2 = useNativeEditDiff(
		() => _props.oldStr,
		() => _props.newStr,
		() => _props.isStreaming || !_source.visible,
	);
	return (
		<div
			ref={(_element) => assignRef(_source.ref, _element)}
			style={domStyle(
				inlineStyles.getMiniEditDiffDivStyle(
					_source2.prepared.hasChanges ? undefined : 28,
				),
			)}
		>
			<EditDiffCard
				filePath={_props.filePath}
				prepared={_source2.prepared}
				error={_source2.error}
				isStreaming={_props.isStreaming || _source2.loading || !_source.visible}
			/>
		</div>
	);
}
