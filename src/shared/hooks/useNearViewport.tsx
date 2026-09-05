import { useEffect, useRef, useState } from "octane";
/** Expensive data preparation begins only when its presentation is nearby. */
export function useNearViewport() {
	const ref = useRef<HTMLDivElement | null>(null);
	const [visible, setVisible] = useState(
		typeof IntersectionObserver === "undefined",
	);
	useEffect(() => {
		if (!ref.current || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry) setVisible(entry.isIntersecting);
			},
			{ rootMargin: "600px" },
		);
		observer.observe(ref.current);
		return () => observer.disconnect();
	}, []);
	return { ref, visible };
}
