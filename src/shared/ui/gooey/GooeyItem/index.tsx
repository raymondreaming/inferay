import {
	type GooeyItemProps,
	toEffects,
	useGooeyContext,
} from "../observer.ts";
import { MirroredItem } from "./MirroredItem.tsx";
import { ObservedItem } from "./ObservedItem.tsx";

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

export type { GooeyEffect, GooeyItemProps } from "../observer.ts";
