import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import {
	updateAppBackground,
	useBackgroundModel,
} from "../../../../app/hooks/useAppAppearance.tsx";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconFolder } from "../../../../shared/ui/Icons/index.tsx";
import { BackgroundSceneCard } from "./BackgroundSceneCard.tsx";
import { BackgroundSceneControls } from "./BackgroundSceneControls.tsx";
import { styles } from "./styles.ts";
export function BackgroundScenePicker(_props: { contained?: boolean }) {
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
			const formData = new FormData();
			formData.append("file", file);
			const response = await fetch("/api/config/background-image", {
				method: "POST",
				body: formData,
			});
			if (!response.ok) {
				const failure = await response.json().catch(() => null);
				throw new Error(failure?.error || "Could not import that image");
			}
			const payload = (await response.json()) as {
				revision: number;
			};
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
		<div
			{...stylex.attrs(
				styles.section,
				(_props.contained === undefined ? false : _props.contained) &&
					styles.sectionContained,
			)}
		>
			<div {...stylex.attrs(styles.backgroundHeadingRow)}>
				<div>
					<h4 {...stylex.attrs(styles.sectionHeading)}>Background</h4>
					<p {...stylex.attrs(styles.sectionDescription)}>
						Choose a clean solid background, a scene, or desktop glass.
					</p>
				</div>
				{_source().background.mode === "scene" ? (
					<Button
						liquid={false}
						type="button"
						size="sm"
						variant="secondary"
						onClick={() => fileInputRef.current?.click()}
						disabled={uploading()}
					>
						<IconFolder size={iconSize.sm} />
						{uploading() ? "Importing…" : "Choose image"}
					</Button>
				) : null}
				<input
					ref={(element) => (fileInputRef.current = element)}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					onInput={(event) =>
						void uploadCustomBackground(event.currentTarget.files?.[0] ?? null)
					}
					{...stylex.attrs(styles.hiddenFileInput)}
				/>
			</div>
			<div {...stylex.attrs(styles.colorSourceOptions)}>
				{(["solid", "scene", "glass"] as const).map((mode) => (
					<button
						type="button"
						onClick={() =>
							updateAppBackground({
								mode,
							})
						}
						{...stylex.attrs(
							styles.colorSourceButton,
							_source().background.mode === mode &&
								styles.colorSourceButtonSelected,
						)}
					>
						{mode === "solid"
							? "Solid black"
							: mode === "scene"
								? "Scene"
								: "Glass"}
					</button>
				))}
			</div>
			{_source().background.mode === "scene" ? (
				<>
					<div {...stylex.attrs(styles.backgroundGrid)}>
						{
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
						}
					</div>
					{uploadError() ? (
						<p {...stylex.attrs(styles.backgroundError)}>{uploadError()}</p>
					) : null}
					<BackgroundSceneControls
						background={_source().background}
						updateBackground={updateAppBackground}
					/>
				</>
			) : null}
			{_source().background.mode === "glass" ? (
				<div {...stylex.attrs(styles.backgroundControls)}>
					<label {...stylex.attrs(styles.backgroundControl)}>
						<span>Window blur</span>
						<input
							type="range"
							min="0"
							max="40"
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
					</label>
					<label {...stylex.attrs(styles.backgroundControl)}>
						<span>Window transparency</span>
						<input
							type="range"
							min="0"
							max="92"
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
					</label>
				</div>
			) : null}
		</div>
	);
}
