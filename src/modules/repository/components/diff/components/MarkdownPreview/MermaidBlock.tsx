import * as stylex from "@stylexjs/stylex";
import { createEffect, createSignal } from "solid-js";
import { styles } from "./styles.ts";

let renderer: Promise<typeof import("mermaid")["default"]> | undefined;
function loadMermaid() {
	return (renderer ??= import("mermaid")
		.then(({ default: mermaid }) => {
			mermaid.initialize({
				startOnLoad: false,
				securityLevel: "strict",
				theme: "dark",
				suppressErrorRendering: true,
			});
			return mermaid;
		})
		.catch((error) => {
			renderer = undefined;
			throw error;
		}));
}

export function MermaidBlock(_props: { code: string }) {
	let container: HTMLDivElement | undefined;
	const [error, setError] = createSignal<string | null>(null);
	createEffect(
		() => _props.code,
		(code) => {
			let active = true;
			setError(null);
			container?.replaceChildren();
			void loadMermaid()
				.then(async (mermaid) => {
					if (!active || !container) return;
					const { svg } = await mermaid.render(
						`mermaid-${crypto.randomUUID()}`,
						code,
					);
					// Mermaid's strict renderer sanitizes SVG, including its HTML labels.
					if (active && container) container.innerHTML = svg;
				})
				.catch((cause) => {
					if (active)
						setError(cause instanceof Error ? cause.message : String(cause));
				});
			return () => {
				active = false;
			};
		},
	);
	return (
		<div {...stylex.attrs(styles.mermaidBox)}>
			<div
				ref={(element) => {
					container = element;
				}}
				{...stylex.attrs(styles.mermaidRender)}
			/>
			{error() && (
				<details>
					<summary>Diagram could not be rendered</summary>
					<pre {...stylex.attrs(styles.errorPre)}>{error()}</pre>
					<pre {...stylex.attrs(styles.codeText)}>{_props.code}</pre>
				</details>
			)}
		</div>
	);
}
