import { iconSize } from "@design-system/styles.stylex.ts";
import {
	updateAppBackground,
	useBackgroundModel,
	usesNativeGlass,
} from "@settings/hooks/useAppAppearance.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconFolder } from "@shared/ui/Icons/index.tsx";
import {
	SettingsRow,
	SettingsSection,
	SettingsSegment,
	SettingsSegmented,
} from "@shared/ui/SettingsSurface/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import { settingsApi } from "../../services/settingsApi.ts";
import { editorStyles as styles } from "./styles.ts";

const BACKGROUND_MODES = [
	{ id: "solid", label: "Black" },
	{ id: "glass", label: "Glass" },
	{ id: "scene", label: "Scene" },
] as const;
const BACKGROUND_RANGES = [
	{ mode: "scene", key: "dim", label: "Darkness", max: 85, unit: "%" },
	{ mode: "scene", key: "blur", label: "Image softness", max: 20, unit: "px" },
	{
		mode: "glass",
		key: "glassBlur",
		label: "Window blur",
		max: 60,
		unit: "px",
	},
	{
		mode: "glass",
		key: "glassOpacity",
		label: "Window transparency",
		max: 92,
		unit: "%",
	},
] as const;
export function BackgroundScenePicker() {
	const source = useBackgroundModel();
	const [uploading, setUploading] = createSignal(false);
	const [uploadError, setUploadError] = createSignal<string | null>(null);
	let fileInput: HTMLInputElement | undefined;
	const uploadCustomBackground = async (file: File | null) => {
		if (!file) return;
		setUploading(true);
		setUploadError(null);
		try {
			const payload = await settingsApi.uploadBackgroundImage(file);
			updateAppBackground({
				customRevision: payload.revision,
			});
		} catch (error) {
			setUploadError(
				error instanceof Error ? error.message : "Could not import that image",
			);
		} finally {
			setUploading(false);
			if (fileInput) fileInput.value = "";
		}
	};
	return (
		<SettingsSection
			id="background"
			title="Background"
			description="Choose a clean solid background, a scene, or desktop glass."
			action={
				source().background.mode === "scene" ? (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						onClick={() => fileInput?.click()}
						disabled={uploading()}
						class={stylex.attrs(styles.noShrink).class}
					>
						<IconFolder size={iconSize.md} />
						<span>{uploading() ? "Importing…" : "Choose image"}</span>
					</Button>
				) : undefined
			}
		>
			<input
				ref={(element) => {
					fileInput = element;
				}}
				type="file"
				accept="image/png,image/jpeg,image/webp,image/gif"
				onInput={(event) =>
					void uploadCustomBackground(event.currentTarget.files?.[0] ?? null)
				}
				{...stylex.attrs(styles.hiddenFileInput)}
			/>
			<SettingsRow label="Style">
				<SettingsSegmented label="Background style">
					{BACKGROUND_MODES.map((mode) => (
						<SettingsSegment
							selected={source().background.mode === mode.id}
							onSelect={() =>
								updateAppBackground({
									mode: mode.id,
								})
							}
						>
							{mode.label}
						</SettingsSegment>
					))}
				</SettingsSegmented>
			</SettingsRow>
			{source().background.mode === "scene" ? (
				<>
					<div {...stylex.attrs(styles.sceneArea)}>
						<div {...stylex.attrs(styles.backgroundGrid)}>
							<For each={source().scenes} keyed={(row) => row.id}>
								{(scene) => {
									const selected = createMemo(
										() => source().background.id === scene().id,
									);
									return (
										<button
											type="button"
											{...stylex.attrs(
												styles.backgroundCard,
												selected() && styles.backgroundCardSelected,
											)}
											onClick={() =>
												scene().id === "custom" &&
												source().background.customRevision === 0
													? fileInput?.click()
													: updateAppBackground({ id: scene().id })
											}
										>
											<span
												{...stylex.attrs(styles.backgroundPreview)}
												style={{
													"background-image": scene().path
														? `linear-gradient(rgba(2,3,8,.12), rgba(2,3,8,.32)), url("${scene().path}")`
														: "linear-gradient(135deg, #272938, #0a0b10)",
												}}
											/>
											<span {...stylex.attrs(styles.backgroundName)}>
												{scene().name}
											</span>
										</button>
									);
								}}
							</For>
						</div>
						{uploadError() ? (
							<p {...stylex.attrs(styles.backgroundError)}>{uploadError()}</p>
						) : null}
					</div>
				</>
			) : null}
			<For
				each={BACKGROUND_RANGES.filter(
					(range) =>
						range.mode === source().background.mode &&
						!(usesNativeGlass && range.key === "glassBlur"),
				)}
			>
				{(range) => {
					const value = createMemo(() =>
						range.key === "glassOpacity"
							? 100 - source().background.glassOpacity
							: source().background[range.key],
					);
					return (
						<SettingsRow label={range.label}>
							<input
								type="range"
								min="0"
								max={range.max}
								aria-label={range.label}
								value={value()}
								{...stylex.attrs(styles.backgroundRange)}
								onInput={(event) =>
									updateAppBackground({
										[range.key]:
											range.key === "glassOpacity"
												? 100 - Number(event.currentTarget.value)
												: Number(event.currentTarget.value),
									})
								}
							/>
							<span {...stylex.attrs(styles.backgroundValue)}>
								{value()}
								{range.unit}
							</span>
						</SettingsRow>
					);
				}}
			</For>
		</SettingsSection>
	);
}
