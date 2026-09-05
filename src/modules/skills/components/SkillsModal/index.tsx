import { useEffect, useState } from "octane";
import { listenWindowEvent } from "../../../../shared/lib/data.ts";
import {
	OPEN_SKILLS_EVENT,
	type SkillsTarget,
} from "../../model/skill-library.ts";
import { SkillsDialog } from "./SkillsDialog.tsx";

export function SkillsModalHost() {
	const [request, setRequest] = useState<{
		target: SkillsTarget;
		key: number;
	} | null>(null);
	useEffect(
		() =>
			listenWindowEvent(OPEN_SKILLS_EVENT, (event) => {
				const target = (event as CustomEvent<SkillsTarget>).detail;
				setRequest({ target: target ?? { mode: "browse" }, key: Date.now() });
			}),
		[],
	);
	return request ? (
		<SkillsDialog
			key={request.key}
			target={request.target}
			onClose={() => setRequest(null)}
		/>
	) : null;
}
