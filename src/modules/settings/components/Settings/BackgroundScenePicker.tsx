import * as stylex from "@octanejs/stylex";
import { useCallback, useRef, useState } from "octane";
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

export function BackgroundScenePicker({
	contained = false,
}: {
	contained?: boolean;
}) {
	const { background, scenes } = useBackgroundModel();
	const [uploading, setUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

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
					const failure = await response.json().catch(() => null);
					throw new Error(failure?.error || "Could not import that image");
				}
				const payload = (await response.json()) as { revision: number };
				updateAppBackground({
					customRevision: payload.revision,
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
		[updateAppBackground],
	);

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
						onClick={() => updateAppBackground({ mode })}
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
								<BackgroundSceneCard
									key={scene.id}
									scene={scene}
									selected={selected}
									onSelect={() =>
										scene.id === "custom" && background.customRevision === 0
											? fileInputRef.current?.click()
											: updateAppBackground({ id: scene.id })
									}
								/>
							);
						})}
					</div>
					{uploadError ? (
						<p {...stylex.props(styles.backgroundError)}>{uploadError}</p>
					) : null}
					<BackgroundSceneControls
						background={background}
						updateBackground={updateAppBackground}
					/>
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
								updateAppBackground({
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
								updateAppBackground({
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
