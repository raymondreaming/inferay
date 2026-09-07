import { createEffect, createSignal, onSettled, Show } from "solid-js";
import {
	listenWindowEvent,
	OPEN_SKILLS_EVENT,
	type SkillsTarget,
} from "../../../../shared/lib/dom.tsx";
import { SkillsDialog } from "./SkillsDialog.tsx";
export function SkillsModalHost() {
	const [request, setRequest] = createSignal<{
		target: SkillsTarget;
		key: number;
	} | null>(null);
	onSettled(() => {
		return listenWindowEvent(OPEN_SKILLS_EVENT, (event) => {
			const target = (event as CustomEvent<SkillsTarget>).detail;
			setRequest({
				target: target ?? {
					mode: "browse",
				},
				key: Date.now(),
			});
		});
	});
	return (
		<Show when={request()} keyed>
			{(value) => (
				<SkillsDialog target={value.target} onClose={() => setRequest(null)} />
			)}
		</Show>
	);
}
