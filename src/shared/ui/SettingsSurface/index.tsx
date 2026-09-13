import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { ariaValue } from "../../lib/dom.tsx";
import { styles } from "./styles.ts";
export function SettingsStack(_props: { children: Element }) {
	return <div {...stylex.attrs(styles.stack)}>{_props.children}</div>;
}
export function SettingsSection(_props: {
	id?: string;
	title: string;
	description?: string;
	action?: Element;
	children: Element;
}) {
	return (
		<section id={_props.id} {...stylex.attrs(styles.section)}>
			<div {...stylex.attrs(styles.sectionHead)}>
				<div {...stylex.attrs(styles.sectionHeadText)}>
					<h2 {...stylex.attrs(styles.sectionTitle)}>{_props.title}</h2>
					{_props.description ? (
						<p {...stylex.attrs(styles.sectionDescription)}>
							{_props.description}
						</p>
					) : null}
				</div>
				{_props.action ? (
					<div {...stylex.attrs(styles.sectionAction)}>{_props.action}</div>
				) : null}
			</div>
			<div {...stylex.attrs(styles.sectionBody)}>{_props.children}</div>
		</section>
	);
}
export function SettingsRow(_props: {
	label?: Element;
	description?: Element;
	children: Element;
}) {
	return (
		<div {...stylex.attrs(styles.row)}>
			{_props.label === undefined ? null : (
				<div {...stylex.attrs(styles.rowText)}>
					<span {...stylex.attrs(styles.rowLabel)}>{_props.label}</span>
					{_props.description === undefined ? null : (
						<span {...stylex.attrs(styles.rowDescription)}>
							{_props.description}
						</span>
					)}
				</div>
			)}
			<div
				{...stylex.attrs(
					styles.rowControl,
					_props.label === undefined && styles.rowControlFill,
				)}
			>
				{_props.children}
			</div>
		</div>
	);
}
export function SettingsEmpty(_props: { children: Element }) {
	return <p {...stylex.attrs(styles.empty)}>{_props.children}</p>;
}
export function SettingsSegmented(_props: {
	label: string;
	children: Element;
}) {
	return (
		<div
			role="group"
			aria-label={ariaValue(_props.label)}
			{...stylex.attrs(styles.segmented)}
		>
			{_props.children}
		</div>
	);
}
export function SettingsSegment(_props: {
	selected: boolean;
	disabled?: boolean;
	title?: string;
	icon?: Element;
	onSelect: () => void;
	children: Element;
}) {
	return (
		<button
			type="button"
			title={_props.title}
			disabled={_props.disabled === true}
			aria-pressed={ariaValue(_props.selected ? "true" : "false")}
			onClick={_props.onSelect}
			{...stylex.attrs(
				styles.segment,
				_props.selected && styles.segmentSelected,
			)}
		>
			{_props.icon === undefined ? null : (
				<span {...stylex.attrs(styles.segmentIcon)}>{_props.icon}</span>
			)}
			{_props.children}
		</button>
	);
}
