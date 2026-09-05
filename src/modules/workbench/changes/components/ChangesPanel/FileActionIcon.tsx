import { IconMinus, IconPlus } from "../../../../../shared/ui/Icons/index.tsx";

export function FileActionIcon({
	actionLabel,
	size = 11,
}: {
	actionLabel?: string;
	size?: number;
}) {
	return actionLabel === "Unstage" ? (
		<IconMinus size={size} />
	) : (
		<IconPlus size={size} />
	);
}
