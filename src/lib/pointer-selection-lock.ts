let activeLocks = 0;
let previousBodyUserSelect = "";
let previousRootUserSelect = "";
let previousBodyWebkitUserSelect = "";
let previousRootWebkitUserSelect = "";
const preventSelection = (event: Event) => event.preventDefault();

export function lockPointerSelection(): () => void {
	if (activeLocks === 0) {
		previousBodyUserSelect = document.body.style.userSelect;
		previousRootUserSelect = document.documentElement.style.userSelect;
		previousBodyWebkitUserSelect = document.body.style.getPropertyValue(
			"-webkit-user-select",
		);
		previousRootWebkitUserSelect =
			document.documentElement.style.getPropertyValue("-webkit-user-select");
		document.body.style.userSelect = "none";
		document.documentElement.style.userSelect = "none";
		document.body.style.setProperty("-webkit-user-select", "none");
		document.documentElement.style.setProperty("-webkit-user-select", "none");
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
			document.body.style.userSelect = previousBodyUserSelect;
			document.documentElement.style.userSelect = previousRootUserSelect;
			document.body.style.setProperty(
				"-webkit-user-select",
				previousBodyWebkitUserSelect,
			);
			document.documentElement.style.setProperty(
				"-webkit-user-select",
				previousRootWebkitUserSelect,
			);
			document.removeEventListener("selectstart", preventSelection, true);
			window.getSelection()?.removeAllRanges();
		}
	};
}
