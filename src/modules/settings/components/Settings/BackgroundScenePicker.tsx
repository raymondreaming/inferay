import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useRef, useState } from "octane";
import { resolveServerUrl } from "../../../../adapters/backend/http.ts";
import { APP_BACKGROUND_STORAGE_KEY } from "../../../../adapters/storage/keys.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../../../adapters/storage/sync.ts";
import {
	APP_BACKGROUNDS,
	type AppBackgroundId,
	type AppBackgroundSettings,
	applyAppTheme,
	loadAppBackgroundSettings,
	saveAppBackgroundSettings,
	saveAppThemeId,
} from "../../../../app/model/appearance.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { listenWindowEvent } from "../../../../shared/lib/react-events.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconFolder } from "../../../../shared/ui/Icons/index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function BackgroundScenePicker({
	contained = false,
}: {
	contained?: boolean;
}) {
	const [background, setBackground] = useState<AppBackgroundSettings>(
		loadAppBackgroundSettings,
	);
	const [uploading, setUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (key === APP_BACKGROUND_STORAGE_KEY) {
					setBackground(loadAppBackgroundSettings());
				}
			}),
		[],
	);

	const updateBackground = useCallback(
		(patch: Partial<AppBackgroundSettings>) => {
			setBackground((current) => {
				const next = { ...current, ...patch };
				saveAppBackgroundSettings(next);
				return next;
			});
		},
		[],
	);
	const selectBackgroundMode = useCallback(
		(mode: AppBackgroundSettings["mode"]) => {
			saveAppThemeId("default");
			applyAppTheme("default");
			updateBackground({ mode, autoTheme: false });
		},
		[updateBackground],
	);

	const uploadCustomBackground = useCallback(
		async (file: File | null) => {
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
					throw new Error(
						(await response.text()) || "Could not import that image",
					);
				}
				const payload = (await response.json()) as { revision?: number };
				updateBackground({
					id: "custom",
					autoTheme: false,
					customRevision: payload.revision ?? Date.now(),
				});
			} catch (error) {
				setUploadError(
					error instanceof Error
						? error.message
						: "Could not import that image",
				);
			} finally {
				setUploading(false);
				if (fileInputRef.current) fileInputRef.current.value = "";
			}
		},
		[updateBackground],
	);

	const scenes: Array<{
		id: AppBackgroundId;
		name: string;
		path: string | null;
	}> = [
		...APP_BACKGROUNDS,
		{
			id: "custom",
			name: "Your image",
			path:
				background.customRevision > 0
					? `/api/config/background-image?v=${background.customRevision}`
					: null,
		},
	];

	return (
		<div
			{...stylex.props(styles.section, contained && styles.sectionContained)}
		>
			<div {...stylex.props(styles.backgroundHeadingRow)}>
				<div>
					<h4 {...stylex.props(styles.sectionHeading)}>Background</h4>
					<p {...stylex.props(styles.sectionDescription)}>
						Choose a clean solid background, a scene, or desktop glass.
					</p>
				</div>
				{background.mode === "scene" ? (
					<Button
						liquid={false}
						type="button"
						size="sm"
						variant="secondary"
						onClick={() => fileInputRef.current?.click()}
						disabled={uploading}
					>
						<IconFolder size={iconSize.sm} />
						{uploading ? "Importing…" : "Choose image"}
					</Button>
				) : null}
				<input
					ref={fileInputRef}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					onChange={(event) =>
						void uploadCustomBackground(event.currentTarget.files?.[0] ?? null)
					}
					{...stylex.props(styles.hiddenFileInput)}
				/>
			</div>
			<div {...stylex.props(styles.colorSourceOptions)}>
				{(["solid", "scene", "glass"] as const).map((mode) => (
					<button
						key={mode}
						type="button"
						onClick={() => selectBackgroundMode(mode)}
						{...stylex.props(
							styles.colorSourceButton,
							background.mode === mode && styles.colorSourceButtonSelected,
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
			{background.mode === "scene" ? (
				<>
					<div {...stylex.props(styles.backgroundGrid)}>
						{scenes.map((scene) => {
							const selected = background.id === scene.id;
							return (
								<button
									key={scene.id}
									type="button"
									onClick={() =>
										scene.id === "custom" && background.customRevision === 0
											? fileInputRef.current?.click()
											: updateBackground({
													id: scene.id,
													autoTheme: false,
												})
									}
									{...stylex.props(
										styles.backgroundCard,
										selected && styles.backgroundCardSelected,
									)}
								>
									<span
										{...stylex.props(styles.backgroundPreview)}
										style={inlineStyles.getBackgroundScenePickerBackgroundPreviewStyle(
											scene.path
												? `linear-gradient(rgba(2,3,8,.12), rgba(2,3,8,.32)), url("${resolveServerUrl(scene.path)}")`
												: "linear-gradient(135deg, #272938, #0a0b10)",
										)}
									/>
									<span {...stylex.props(styles.backgroundName)}>
										{scene.name}
									</span>
								</button>
							);
						})}
					</div>
					{uploadError ? (
						<p {...stylex.props(styles.backgroundError)}>{uploadError}</p>
					) : null}
					<div {...stylex.props(styles.backgroundControls)}>
						<label {...stylex.props(styles.backgroundControl)}>
							<span>Darkness</span>
							<input
								type="range"
								min="0"
								max="85"
								value={background.dim}
								{...stylex.props(styles.backgroundRange)}
								onInput={(event) =>
									updateBackground({ dim: Number(event.currentTarget.value) })
								}
							/>
							<span {...stylex.props(styles.backgroundValue)}>
								{background.dim}%
							</span>
						</label>
						<label {...stylex.props(styles.backgroundControl)}>
							<span>Image softness</span>
							<input
								type="range"
								min="0"
								max="20"
								value={background.blur}
								{...stylex.props(styles.backgroundRange)}
								onInput={(event) =>
									updateBackground({ blur: Number(event.currentTarget.value) })
								}
							/>
							<span {...stylex.props(styles.backgroundValue)}>
								{background.blur}px
							</span>
						</label>
					</div>
				</>
			) : null}
			{background.mode === "glass" ? (
				<div {...stylex.props(styles.backgroundControls)}>
					<label {...stylex.props(styles.backgroundControl)}>
						<span>Window blur</span>
						<input
							type="range"
							min="0"
							max="40"
							value={background.glassBlur}
							{...stylex.props(styles.backgroundRange)}
							onInput={(event) =>
								updateBackground({
									glassBlur: Number(event.currentTarget.value),
								})
							}
						/>
						<span {...stylex.props(styles.backgroundValue)}>
							{background.glassBlur}px
						</span>
					</label>
					<label {...stylex.props(styles.backgroundControl)}>
						<span>Window transparency</span>
						<input
							type="range"
							min="0"
							max="92"
							value={100 - background.glassOpacity}
							{...stylex.props(styles.backgroundRange)}
							onInput={(event) =>
								updateBackground({
									glassOpacity: 100 - Number(event.currentTarget.value),
								})
							}
						/>
						<span {...stylex.props(styles.backgroundValue)}>
							{100 - background.glassOpacity}%
						</span>
					</label>
				</div>
			) : null}
		</div>
	);
}
