import type { ProjectEffectIntent } from "@contracts";

export function effectStatus(effect: ProjectEffectIntent): string {
	switch (effect.delivery?.state) {
		case "queued":
			return "Queued · Not sent";
		case "in_flight":
			return "In progress · Outcome pending";
		case "uncertain":
			return effect.delivery.cancellationRequestedAt !== null
				? "Stop requested · Outcome unknown"
				: "Outcome unknown · Needs reconciliation";
		case "delivered":
			return "Delivered";
		case "cancelled":
			return "Cancelled · Not sent";
		default:
			return effect.dismissedAt === null
				? "Pending review · Not sent"
				: "Dismissed · Not sent";
	}
}
