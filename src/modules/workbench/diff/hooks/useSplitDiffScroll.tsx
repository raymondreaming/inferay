import { useCallback, useEffect, useRef, useState } from "octane";
import type React from "react";

export type DiffScrollSource = "left" | "right" | "all";

export function useSplitDiffScroll(
	masterRef: React.RefObject<HTMLDivElement | null>,
	lineHeight: number,
	externalScrollTop?: number,
	externalScrollSource?: DiffScrollSource,
) {
	const followerRef = useRef<HTMLDivElement | null>(null);
	const [programmaticJumpTop, setProgrammaticJumpTop] = useState(-1);
	const syncFromMaster = useCallback(
		(top: number, _left: number, programmatic?: boolean) => {
			const follower = followerRef.current;
			if (!follower) return;
			if (Math.abs(follower.scrollTop - top) > 0.5) follower.scrollTop = top;
			if (programmatic) setProgrammaticJumpTop(top);
		},
		[],
	);

	useEffect(() => {
		const follower = followerRef.current;
		const master = masterRef.current;
		if (!follower || !master) return;
		const scrollTogether = (event: WheelEvent) => {
			if (event.deltaY === 0) return;
			event.preventDefault();
			const unit =
				event.deltaMode === 1
					? lineHeight
					: event.deltaMode === 2
						? master.clientHeight
						: 1;
			if (event.deltaX) {
				(event.currentTarget as HTMLDivElement).scrollLeft +=
					event.deltaX * unit;
			}
			master.scrollTop += event.deltaY * unit;
			follower.scrollTop = master.scrollTop;
		};
		follower.addEventListener("wheel", scrollTogether, { passive: false });
		master.addEventListener("wheel", scrollTogether, { passive: false });
		return () => {
			follower.removeEventListener("wheel", scrollTogether);
			master.removeEventListener("wheel", scrollTogether);
		};
	}, [lineHeight, masterRef]);

	const hasExternalJump =
		externalScrollTop !== undefined && externalScrollTop >= 0;
	return {
		followerRef,
		followerScrollSource: hasExternalJump ? externalScrollSource : "right",
		followerScrollTop: hasExternalJump
			? externalScrollTop
			: programmaticJumpTop,
		syncFromMaster,
	};
}
