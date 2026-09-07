import { IconMinus, IconPlus } from "../../../../../shared/ui/Icons/index.tsx";
export function FileActionIcon(_props: {
	actionLabel?: string;
	size?: number;
}) {
	return _props.actionLabel === "Unstage" ? (
		<IconMinus size={_props.size === undefined ? 11 : _props.size} />
	) : (
		<IconPlus size={_props.size === undefined ? 11 : _props.size} />
	);
}
