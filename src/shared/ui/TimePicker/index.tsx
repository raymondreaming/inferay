import { DropdownButton } from "../DropdownButton/index.tsx";
export function formatTime(value: string): string {
	const [hour, minute] = value.split(":").map(Number);
	return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
}
export function parseTime(text: string): string | null {
	const match = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
	if (!match) return null;
	let hour = Number(match[1]);
	const minute = Number(match[2] ?? 0);
	if (minute > 59 || hour > 23 || (match[3] && (hour < 1 || hour > 12)))
		return null;
	if (match[3]) hour = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
export function TimePicker(props: {
	value: string;
	onChange: (value: string) => void;
}) {
	const options = () =>
		[
			...new Set([
				props.value,
				...Array.from(
					{ length: 24 },
					(_, h) => `${String(h).padStart(2, "0")}:00`,
				),
			]),
		]
			.sort()
			.map((id) => ({ id, label: formatTime(id) }));
	return (
		<DropdownButton
			label="Run time"
			value={props.value}
			options={options()}
			onChange={props.onChange}
			minWidth={180}
			maxVisibleOptions={8}
			searchPlaceholder="Type a time, e.g. 10:15 AM"
			customOption={(text) => {
				const id = parseTime(text);
				return id ? { id, label: formatTime(id) } : null;
			}}
		/>
	);
}
