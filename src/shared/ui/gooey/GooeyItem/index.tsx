import { useGooeyContext } from "../context";
import { MirroredItem } from "./MirroredItem.tsx";
import { ObservedItem } from "./ObservedItem.tsx";
import { type GooeyItemProps, toEffects } from "./shared.ts";

export function GooeyItem(props: GooeyItemProps) {
	const ctx = useGooeyContext();
	const needsEngine =
		props.observe || toEffects(props.effect).some((e) => e !== "morph");
	return needsEngine ? (
		<ObservedItem {...props} ctx={ctx} />
	) : (
		<MirroredItem {...props} ctx={ctx} />
	);
}

export type { DissolveOptions, GooeyEffect, GooeyItemProps } from "./shared.ts";
