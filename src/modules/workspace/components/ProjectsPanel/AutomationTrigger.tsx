import type { Trigger } from "@contracts";
import { project } from "@shared/lib/native.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import { TimePicker } from "@shared/ui/TimePicker/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal } from "solid-js";
import { styles } from "./styles.ts";

export function AutomationTrigger(props: {
	trigger: Trigger;
	onChange: (trigger: Trigger) => void;
}) {
	const [custom, setCustom] = createSignal(
		props.trigger.kind === "interval" && props.trigger.seconds !== 3600,
	);
	const calendar = () =>
		props.trigger.kind === "calendar" ? props.trigger : undefined;
	const seconds = () =>
		props.trigger.kind === "interval"
			? props.trigger.seconds
			: calendar()
				? calendar()!.days.length === 7
					? 86400
					: 604800
				: 0;
	const editCalendar = (
		patch: Partial<Extract<Trigger, { kind: "calendar" }>>,
	) => {
		const current = calendar();
		if (current) props.onChange({ ...current, ...patch });
	};
	return (
		<section aria-label="Schedule" {...stylex.attrs(styles.editorSection)}>
			<span {...stylex.attrs(styles.editorLabel)}>Triggers</span>
			<div {...stylex.attrs(styles.row)}>
				<DropdownButton
					value={custom() ? "custom" : seconds() ? String(seconds()) : null}
					placeholder="＋ Add trigger"
					minWidth={180}
					options={[
						{ id: "3600", label: "Scheduled · Every hour" },
						{ id: "86400", label: "Scheduled · Every day" },
						{ id: "604800", label: "Scheduled · Every week" },
						{ id: "custom", label: "Scheduled · Custom interval" },
						{ id: "", label: "Manual only" },
					]}
					onChange={(preset) => {
						setCustom(preset === "custom");
						props.onChange(
							project("triggerPreset", {
								trigger: props.trigger,
								preset,
								timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
							}),
						);
					}}
				/>
				{calendar() ? (
					<div {...stylex.attrs(styles.row)}>
						{calendar()!.days.length !== 7 ? (
							<DropdownButton
								label="Day of week"
								value={String((calendar()!.days[0] ?? 1) - 1)}
								options={[
									"Monday",
									"Tuesday",
									"Wednesday",
									"Thursday",
									"Friday",
									"Saturday",
									"Sunday",
								].map((label, id) => ({ id: String(id), label }))}
								onChange={(value) =>
									editCalendar({
										days: [
											...new Set([
												Number(value) + 1,
												...calendar()!.days.slice(1),
											]),
										],
									})
								}
							/>
						) : null}
						<span>at</span>
						<TimePicker
							value={calendar()!.times[0]}
							onChange={(value) =>
								editCalendar({ times: [value, ...calendar()!.times.slice(1)] })
							}
						/>
						<DropdownButton
							label="Timezone"
							value={calendar()!.timezone}
							options={[
								...new Set([
									calendar()!.timezone,
									...Intl.supportedValuesOf("timeZone"),
								]),
							].map((zone) => ({ id: zone, label: zone.replaceAll("_", " ") }))}
							onChange={(value) => editCalendar({ timezone: value })}
						/>
					</div>
				) : null}
			</div>
			{seconds() ? (
				<span {...stylex.attrs(styles.muted)}>
					Enable after saving · Runs while Inferay is open
				</span>
			) : null}
			{custom() ? (
				<label {...stylex.attrs(styles.settingRow)}>
					Every (minutes)
					<input
						type="number"
						required
						min="1"
						max="525600"
						step="any"
						value={seconds() / 60}
						onInput={(e) =>
							props.onChange({
								kind: "interval",
								seconds: Number(e.currentTarget.value) * 60,
							})
						}
						{...stylex.attrs(styles.inlineControl)}
					/>
				</label>
			) : null}
		</section>
	);
}
