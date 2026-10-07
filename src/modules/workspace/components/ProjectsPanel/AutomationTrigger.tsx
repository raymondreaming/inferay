import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import { TimePicker } from "@shared/ui/TimePicker/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";
export function AutomationTrigger(props: {
	seconds: () => string;
	customSchedule: () => boolean;
	scheduleTime: () => string;
	timezone: () => string;
	weekday: () => string;
	setSeconds: (value: string) => void;
	setCustomSchedule: (value: boolean) => void;
	setScheduleTime: (value: string) => void;
	setTimezone: (value: string) => void;
	setWeekday: (value: string) => void;
}) {
	return (
		<section aria-label="Schedule" {...stylex.attrs(styles.editorSection)}>
			<span {...stylex.attrs(styles.editorLabel)}>Triggers</span>
			<div {...stylex.attrs(styles.row)}>
				<DropdownButton
					value={
						props.seconds()
							? props.customSchedule()
								? "custom"
								: props.seconds()
							: null
					}
					placeholder="＋ Add trigger"
					minWidth={180}
					options={[
						{ id: "3600", label: "Scheduled · Every hour" },
						{ id: "86400", label: "Scheduled · Every day" },
						{ id: "604800", label: "Scheduled · Every week" },
						{ id: "custom", label: "Scheduled · Custom interval" },
						{ id: "", label: "Manual only" },
					]}
					onChange={(value) => {
						props.setCustomSchedule(value === "custom");
						if (value !== "custom") props.setSeconds(value);
						else if (!props.seconds()) props.setSeconds("3600");
					}}
				/>
				{!props.customSchedule() &&
				["86400", "604800"].includes(props.seconds()) ? (
					<div {...stylex.attrs(styles.row)}>
						{props.seconds() === "604800" ? (
							<DropdownButton
								label="Day of week"
								value={props.weekday()}
								options={[
									"Monday",
									"Tuesday",
									"Wednesday",
									"Thursday",
									"Friday",
									"Saturday",
									"Sunday",
								].map((label, id) => ({ id: String(id), label }))}
								onChange={props.setWeekday}
							/>
						) : null}
						<span>at</span>
						<TimePicker
							value={props.scheduleTime()}
							onChange={props.setScheduleTime}
						/>
						<DropdownButton
							label="Timezone"
							value={props.timezone()}
							options={[
								...new Set([
									props.timezone(),
									...Intl.supportedValuesOf("timeZone"),
								]),
							].map((zone) => ({ id: zone, label: zone.replaceAll("_", " ") }))}
							onChange={props.setTimezone}
						/>
					</div>
				) : null}
			</div>
			{props.seconds() ? (
				<span {...stylex.attrs(styles.muted)}>
					Enable after saving · Runs while Inferay is open
				</span>
			) : null}
			{props.customSchedule() ? (
				<label {...stylex.attrs(styles.settingRow)}>
					Every (minutes)
					<input
						type="number"
						required
						min="1"
						max="525600"
						step="any"
						value={Number(props.seconds()) / 60}
						onInput={(e) =>
							props.setSeconds(String(Number(e.currentTarget.value) * 60))
						}
						{...stylex.attrs(styles.inlineControl)}
					/>
				</label>
			) : null}
		</section>
	);
}
