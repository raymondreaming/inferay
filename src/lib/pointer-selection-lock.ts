let activeLocks = 0;
let previousUserSelect = "";
const preventSelection = (event: Event) => event.preventDefault();

export function lockPointerSelection(): () => void {
	if (activeLocks === 0) {
		previousUserSelect = document.body.style.userSelect;
		document.body.style.userSelect = "none";
		document.addEventListener("selectstart", preventSelection, true);
		window.getSelection()?.removeAllRanges();
	}
	activeLocks += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		activeLocks = Math.max(0, activeLocks - 1);
		if (activeLocks === 0) {
			document.body.style.userSelect = previousUserSelect;
			document.removeEventListener("selectstart", preventSelection, true);
			window.getSelection()?.removeAllRanges();
		}
	};
}
