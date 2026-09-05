import * as stylex from "@octanejs/stylex";
import { BorderBeam } from "border-beam";
import { useEffect, useRef } from "octane";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { controlSize } from "../../design-system/styles.stylex.ts";

interface BorderBeamOverlayProps {
	active: boolean;
}

export function BorderBeamOverlay({ active }: BorderBeamOverlayProps) {
	const hostRef = useRef<HTMLSpanElement | null>(null);
	const rootRef = useRef<Root | null>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const root = createRoot(host);
		rootRef.current = root;
		return () => {
			rootRef.current = null;
			root.unmount();
		};
	}, []);

	useEffect(() => {
		rootRef.current?.render(
			createElement(BorderBeam, {
				active,
				borderRadius: 12,
				colorVariant: "colorful",
				duration: 2.5,
				size: "md",
				strength: 0.7,
				style: { height: "100%", width: "100%" },
				theme: "dark",
				// biome-ignore lint/correctness/noChildrenProp: BorderBeam requires children in its typed props for createElement.
				children: createElement("span", {
					style: {
						borderRadius: 12,
						display: "block",
						height: "100%",
						width: "100%",
					},
				}),
			}),
		);
	}, [active]);

	return (
		<span ref={hostRef} aria-hidden="true" {...stylex.props(styles.host)} />
	);
}

const styles = stylex.create({
	host: {
		inset: controlSize._0,
		pointerEvents: "none",
		position: "absolute",
		zIndex: 3,
	},
});
