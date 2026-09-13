import {
	updateAppBackground,
	useBackgroundModel,
	usesNativeGlass,
} from "@app/hooks/useAppAppearance.tsx";
import { iconSize } from "@design-system/styles.stylex.ts";
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
import { BackgroundSceneCard } from "./BackgroundSceneCard.tsx";
import { BackgroundSceneControls } from "./BackgroundSceneControls.tsx";
import { styles } from "./styles.ts";

const BACKGROUND_MODES = [
	{ id: "solid", label: "Black" },
	{ id: "glass", label: "Glass" },
	{ id: "scene", label: "Scene" },
] as const;
export function BackgroundScenePicker() {
	const _source = useBackgroundModel();
	const [uploading, setUploading] = createSignal(false);
	const [uploadError, setUploadError] = createSignal<string | null>(null);
	const fileInputRef = {
		current: null,
	} as {
		current: HTMLInputElement | null;
	};
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
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};
	return (
		<SettingsSection
			id="background"
			title="Background"
			description="Choose a clean solid background, a scene, or desktop glass."
			action={
				_source().background.mode === "scene" ? (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						onClick={() => fileInputRef.current?.click()}
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
				ref={(element) => (fileInputRef.current = element)}
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
							selected={_source().background.mode === mode.id}
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
			{_source().background.mode === "scene" ? (
				<>
					<div {...stylex.attrs(styles.sceneArea)}>
						<div {...stylex.attrs(styles.backgroundGrid)}>
							<For each={_source().scenes} keyed={(row) => row.id}>
								{(scene) => {
									const selected = createMemo(
										() => _source().background.id === scene().id,
									);
									return (
										<BackgroundSceneCard
											scene={scene()}
											selected={selected()}
											onSelect={() =>
												scene().id === "custom" &&
												_source().background.customRevision === 0
													? fileInputRef.current?.click()
													: updateAppBackground({
															id: scene().id,
														})
											}
										/>
									);
								}}
							</For>
						</div>
						{uploadError() ? (
							<p {...stylex.attrs(styles.backgroundError)}>{uploadError()}</p>
						) : null}
					</div>
					<BackgroundSceneControls
						background={_source().background}
						updateBackground={updateAppBackground}
					/>
				</>
			) : null}
			{_source().background.mode === "glass" ? (
				<>
					{!usesNativeGlass ? (
						<SettingsRow label="Window blur">
							<input
								type="range"
								min="0"
								max="60"
								aria-label="Window blur"
								value={_source().background.glassBlur}
								{...stylex.attrs(styles.backgroundRange)}
								onInput={(event) =>
									updateAppBackground({
										glassBlur: Number(event.currentTarget.value),
									})
								}
							/>
							<span {...stylex.attrs(styles.backgroundValue)}>
								{_source().background.glassBlur}px
							</span>
						</SettingsRow>
					) : null}
					<SettingsRow label="Window transparency">
						<input
							type="range"
							min="0"
							max="92"
							aria-label="Window transparency"
							value={100 - _source().background.glassOpacity}
							{...stylex.attrs(styles.backgroundRange)}
							onInput={(event) =>
								updateAppBackground({
									glassOpacity: 100 - Number(event.currentTarget.value),
								})
							}
						/>
						<span {...stylex.attrs(styles.backgroundValue)}>
							{100 - _source().background.glassOpacity}%
						</span>
					</SettingsRow>
				</>
			) : null}
		</SettingsSection>
	);
}
