import {
	createPortal,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "octane";
import type { ReactNode } from "../../../types/octane-react-compat.ts";
import { IconLayoutGrid, IconMessageCircle } from "../Icons.tsx";
import { Liquid } from "./index.ts";

export interface LiquidCreateMenuProps {
	open: boolean;
	trigger: ReactNode;
	fill: string;
	onNewChat: () => void;
	onNewWorkspace: () => void;
	fullWidth?: boolean;
}

/** A portalled, fixed-size stage whose panel emerges from its trigger. */
export function LiquidCreateMenu({
	open,
	trigger,
	fill,
	onNewChat,
	onNewWorkspace,
	fullWidth = false,
}: LiquidCreateMenuProps) {
	const slotRef = useRef<HTMLSpanElement | null>(null);
	const [mounted, setMounted] = useState(false);
	const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(
		null,
	);
	const updateAnchor = useCallback(() => {
		const rect = slotRef.current?.getBoundingClientRect();
		if (rect) setAnchor({ left: rect.left, top: rect.top });
	}, []);

	useEffect(() => setMounted(true), []);
	useLayoutEffect(updateAnchor, [updateAnchor]);
	useEffect(() => {
		if (!mounted) return;
		window.addEventListener("resize", updateAnchor);
		window.addEventListener("scroll", updateAnchor, true);
		return () => {
			window.removeEventListener("resize", updateAnchor);
			window.removeEventListener("scroll", updateAnchor, true);
		};
	}, [mounted, updateAnchor]);

	return (
		<>
			<span
				ref={slotRef}
				className="inferay-liquid-create__slot"
				style={{ width: fullWidth ? "100%" : undefined }}
			/>
			{mounted &&
				anchor &&
				createPortal(
					<Liquid
						blur={6}
						contrast={18}
						fill={fill}
						filterPadding={32}
						shadow="inset 0 1px 0 rgba(255,255,255,.12), 0 10px 28px rgba(0,0,0,.34)"
						className="inferay-liquid-create__stage"
						style={{ position: "fixed", left: anchor.left, top: anchor.top }}
						onMouseDown={(event) => event.stopPropagation()}
					>
						<Liquid.Item className="inferay-liquid-create__trigger">
							{trigger}
						</Liquid.Item>
						<Liquid.Item
							className="inferay-liquid-create__panel-item"
							x={open ? 48 : 0}
							scale={open ? 1 : 0.01}
							transition={open ? "bouncy" : "snappy"}
						>
							<div
								className="inferay-liquid-create__panel"
								data-open={open ? "true" : "false"}
								aria-hidden={!open}
							>
								<button
									type="button"
									tabIndex={open ? 0 : -1}
									onClick={onNewChat}
								>
									<IconMessageCircle size={12} />
									<span>New chat</span>
								</button>
								<button
									type="button"
									tabIndex={open ? 0 : -1}
									onClick={onNewWorkspace}
								>
									<IconLayoutGrid size={12} />
									<span>New workspace</span>
								</button>
							</div>
						</Liquid.Item>
					</Liquid>,
					document.body,
				)}
		</>
	);
}
