import type { AutomationDefinition } from "@contracts";
export function automationScheduleLabel(
	automation: Pick<AutomationDefinition, "trigger">,
): string {
	const trigger = automation.trigger;
	if (trigger.kind === "manual") return "Manual";
	if (trigger.kind === "interval") {
		if (trigger.seconds === 3600) return "Hourly";
		if (trigger.seconds === 86400) return "Daily";
		if (trigger.seconds === 604800) return "Weekly";
		return `Every ${trigger.seconds / 60} minutes`;
	}
	const days =
		trigger.days.length === 7
			? "Daily"
			: trigger.days
					.map(
						(day) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day - 1],
					)
					.join(", ");
	const times = trigger.times
		.map((time) =>
			new Date(`2000-01-01T${time}:00`).toLocaleTimeString(undefined, {
				hour: "numeric",
				minute: "2-digit",
			}),
		)
		.join(", ");
	return `${days} at ${times} · ${trigger.timezone.replaceAll("_", " ")}`;
}
