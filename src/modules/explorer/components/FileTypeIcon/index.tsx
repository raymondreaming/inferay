import { px } from "@shared/lib/dom.tsx";
import { DEFAULT_FILE, getIconForFile } from "@yutengjing/vscode-icons";

export function FileTypeIcon(_props: {
	readonly path: string;
	readonly size?: number;
	readonly class?: string;
}) {
	return (
		<img
			aria-hidden="true"
			alt=""
			draggable={false}
			src={`/file-icons/${getIconForFile(_props.path.split(/[\\/]/).pop() || _props.path) ?? DEFAULT_FILE}`}
			class={_props.class}
			style={{
				width: _props.size === undefined ? "15px" : px(_props.size),
				height: _props.size === undefined ? "15px" : px(_props.size),
				"flex-shrink": 0,
				opacity: 0.96,
				filter: "saturate(0.76) brightness(1.08)",
			}}
		/>
	);
}
