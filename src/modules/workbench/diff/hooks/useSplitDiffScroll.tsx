import type { Accessor } from "solid-js";
import type { RefCell } from "../../../../shared/lib/dom.tsx";
export type DiffScrollSource = "left" | "right" | "all";
export function useSplitDiffScroll(
	masterRef: Accessor<RefCell<HTMLDivElement | null>>,
	_lineHeight: Accessor<number>,
	externalScrollTop: Accessor<number | undefined> = () => undefined,
	externalScrollSource: Accessor<DiffScrollSource | undefined> = () =>
		undefined,
) {
	const followerRef: RefCell<HTMLDivElement | null> = { current: null };
	// A mirrored scroll event may arrive after the user already moved the other
	// pane again. Consume that acknowledgement instead of bouncing it back.
	const mirrored = new WeakMap<HTMLDivElement, number>();
	const sync = (
		source: HTMLDivElement | null,
		target: HTMLDivElement | null,
		top: number,
	) => {
		if (!source || !target) return;
		const expected = mirrored.get(source);
		mirrored.delete(source);
		if (expected !== undefined && Math.abs(expected - top) <= 0.5) return;
		if (Math.abs(target.scrollTop - top) > 0.5) {
			target.scrollTop = top;
			mirrored.set(target, target.scrollTop);
		}
	};

	return {
		followerRef,
		get followerScrollTop() {
			return externalScrollTop();
		},
		get followerScrollSource() {
			return externalScrollSource();
		},
		syncFromMaster: (top: number, _left: number) =>
			sync(masterRef().current, followerRef.current, top),
		syncFromFollower: (top: number, _left: number) =>
			sync(followerRef.current, masterRef().current, top),
	};
}
