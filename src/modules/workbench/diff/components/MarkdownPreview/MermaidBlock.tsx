import * as stylex from "@octanejs/stylex";
import { useEffect, useRef, useState } from "octane";
import { runtimeFont } from "../../../../../design-system/styles.stylex.ts";
import { styles } from "./styles.ts";

let mermaidPromise: Promise<unknown> | null = null;

function loadMermaid(): Promise<unknown> {
	if (mermaidPromise) return mermaidPromise;
	mermaidPromise = new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
		script.onload = () => {
			const m = (window as unknown as Record<string, unknown>).mermaid as {
				initialize: (cfg: Record<string, unknown>) => void;
			};
			m.initialize({
				startOnLoad: false,
				theme: "dark",
				themeVariables: {
					darkMode: true,
					background: "transparent",
					primaryColor: "var(--color-inferay-gray-border)",
					primaryTextColor: "var(--color-inferay-soft-white)",
					primaryBorderColor: "var(--color-inferay-gray-border-bold)",
					lineColor: "var(--color-inferay-muted-gray)",
					secondaryColor: "var(--color-inferay-gray)",
					tertiaryColor: "var(--color-inferay-dark-gray)",
					fontFamily: runtimeFont.familyMono,
					fontSize: runtimeFont.sizeCompact,
				},
			});
			resolve(m);
		};
		script.onerror = reject;
		document.head.appendChild(script);
	});
	return mermaidPromise;
}

function sanitizeMermaidSvg(svg: string): string {
	const document = new DOMParser().parseFromString(svg, "image/svg+xml");
	for (const element of document.querySelectorAll("script, foreignObject")) {
		element.remove();
	}
	for (const element of document.querySelectorAll("*")) {
		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value.trim().toLowerCase();
			if (
				name.startsWith("on") ||
				((name === "href" || name === "xlink:href") &&
					value.startsWith("javascript:"))
			) {
				element.removeAttribute(attribute.name);
			}
		}
	}
	return new XMLSerializer().serializeToString(document.documentElement);
}

export function MermaidBlock({ code }: { code: string }) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setError(null);
		if (ref.current) ref.current.replaceChildren();
		const controller = new AbortController();
		const { signal } = controller;
		const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		loadMermaid()
			.then(() => {
				if (signal.aborted || !ref.current) return;
				const m = (window as unknown as Record<string, unknown>).mermaid as {
					render: (id: string, code: string) => Promise<{ svg: string }>;
				};
				return m.render(id, code);
			})
			.then((result) => {
				if (signal.aborted || !ref.current || !result) return;
				ref.current.innerHTML = sanitizeMermaidSvg(result.svg);
			})
			.catch((err) => {
				if (!signal.aborted) setError(String(err));
			});
		return controller.abort.bind(controller);
	}, [code]);

	if (error)
		return (
			<div {...stylex.props(styles.mermaidBox)}>
				<pre {...stylex.props(styles.errorPre)}>{error}</pre>
			</div>
		);

	return (
		<div ref={ref} {...stylex.props(styles.mermaidBox, styles.mermaidRender)} />
	);
}
