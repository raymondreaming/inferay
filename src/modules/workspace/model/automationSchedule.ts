import type { ProjectAutomation } from "@contracts";
export function automationScheduleLabel(
	automation: Pick<ProjectAutomation, "calendar" | "intervalSeconds">,
): string {
	const schedule = automation.calendar;
	const time = schedule
		? new Date(`2000-01-01T${schedule.time}:00`).toLocaleTimeString(undefined, {
				hour: "numeric",
				minute: "2-digit",
			})
		: "";
	if (schedule)
		return `${schedule.weekday === null ? "Daily" : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][schedule.weekday]} at ${time} · ${schedule.timezone.replaceAll("_", " ")}`;
	if (automation.intervalSeconds === 86400) return "Daily";
	if (automation.intervalSeconds === 604800) return "Weekly";
	if (automation.intervalSeconds === 3600) return "Hourly";
	return automation.intervalSeconds
		? `Every ${automation.intervalSeconds / 60} minutes`
		: "Manual";
}
