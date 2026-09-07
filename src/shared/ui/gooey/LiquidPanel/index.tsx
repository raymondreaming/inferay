import {
	createEffect,
	createSignal,
	type Element,
	Loading,
	lazy,
	onSettled,
} from "solid-js";
export function LiquidPanel(_props: { children?: Element; fill: string }) {
	const [mounted, setMounted] = createSignal(false);
	onSettled(() => {
		setMounted(true);
	});
	return (
		<>
			{(() => {
				if (!mounted()) return _props.children;
				return (
					<Loading fallback={_props.children}>
						<LazyLiquidPanelSurface fill={_props.fill}>
							{_props.children}
						</LazyLiquidPanelSurface>
					</Loading>
				);
			})()}
		</>
	);
}
const LazyLiquidPanelSurface = lazy(() =>
	import("../LiquidPanelSurface/index.tsx").then((module) => ({
		default: module.LiquidPanelSurface,
	})),
);
