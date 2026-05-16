import * as stylex from "@stylexjs/stylex";
import { useCallback, useState } from "react";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { IconCamera, IconTrash } from "../../components/ui/Icons.tsx";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import { lacksPath } from "../../lib/data.ts";
import { fetchJsonOr } from "../../lib/fetch-json.ts";
import { formatBytes, formatRelativeTime } from "../../lib/format.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";

interface ImageEntry {
	name: string;
	path: string;
	timestamp: number;
	size: number;
}

export function ImagesPage() {
	const {
		data: images,
		setData: setImages,
		loading,
	} = useAsyncResource<ImageEntry[]>(
		() =>
			fetchJsonOr<{ images?: ImageEntry[] }>("/api/images", {}).then(
				(d) => d.images ?? []
			),
		[],
		[]
	);
	const [selected, setSelected] = useState<ImageEntry | null>(null);

	const deleteImage = useCallback(
		async (img: ImageEntry) => {
			try {
				await fetch(`/api/delete-temp?path=${encodeURIComponent(img.path)}`, {
					method: "DELETE",
				});
				setImages((prev) => prev.filter(lacksPath.bind(null, img.path)));
				if (selected?.path === img.path) setSelected(null);
			} catch {}
		},
		[selected, setImages]
	);

	return (
		<div {...stylex.props(styles.root)}>
			<div {...stylex.props(styles.sidebar)}>
				<div {...stylex.props(styles.header)}>
					<IconCamera size={14} {...stylex.props(styles.mutedIcon)} />
					<span {...stylex.props(styles.title)}>Images</span>
					<span {...stylex.props(styles.count)}>{images.length}</span>
				</div>
				<div {...stylex.props(styles.list)}>
					{loading ? (
						<div {...stylex.props(styles.noticeText)}>Loading...</div>
					) : images.length === 0 ? (
						<div {...stylex.props(styles.noticeText)}>
							No images yet. Attach an image in a chat to see it here.
						</div>
					) : (
						images.map((img) => (
							<button
								key={img.path}
								type="button"
								onClick={() => setSelected(img)}
								{...stylex.props(
									styles.imageRow,
									selected?.path === img.path
										? styles.imageRowActive
										: styles.imageRowIdle
								)}
							>
								<img
									src={`/api/file?path=${encodeURIComponent(img.path)}`}
									alt=""
									{...stylex.props(styles.thumbnail)}
								/>
								<div {...stylex.props(styles.rowText)}>
									<div {...stylex.props(styles.imageName)}>{img.name}</div>
									<div {...stylex.props(styles.imageMeta)}>
										<span>{formatRelativeTime(img.timestamp)}</span>
										<span>{formatBytes(img.size)}</span>
									</div>
								</div>
								<IconButton
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										deleteImage(img);
									}}
									variant="danger"
									size="md"
									className={stylex.props(styles.noShrink).className}
									title="Delete"
								>
									<IconTrash size={12} />
								</IconButton>
							</button>
						))
					)}
				</div>
			</div>

			<div {...stylex.props(styles.previewPane)}>
				{selected ? (
					<div {...stylex.props(styles.previewContent)}>
						<img
							src={`/api/file?path=${encodeURIComponent(selected.path)}`}
							alt={selected.name}
							{...stylex.props(styles.previewImage)}
						/>
						<div {...stylex.props(styles.previewMeta)}>
							<span>{selected.name}</span>
							<span>{formatBytes(selected.size)}</span>
							<span>{new Date(selected.timestamp).toLocaleString()}</span>
						</div>
					</div>
				) : (
					<span {...stylex.props(styles.previewEmpty)}>
						Select an image to preview
					</span>
				)}
			</div>
		</div>
	);
}

const styles = stylex.create({
	root: {
		display: "flex",
		height: "100%",
		backgroundColor: color.background,
	},
	sidebar: {
		display: "flex",
		width: "20rem",
		flexDirection: "column",
		borderRightWidth: 1,
		borderRightStyle: "solid",
		borderRightColor: color.border,
	},
	header: {
		display: "flex",
		height: "2.5rem",
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingInline: controlSize._3,
	},
	mutedIcon: {
		color: color.textMuted,
	},
	title: {
		color: color.textSoft,
		fontSize: "0.75rem",
		fontWeight: font.weight_5,
	},
	count: {
		marginLeft: "auto",
		color: color.textMuted,
		fontSize: "0.625rem",
	},
	list: {
		flex: 1,
		overflowY: "auto",
		scrollbarWidth: "none",
		"::-webkit-scrollbar": {
			display: "none",
		},
	},
	noticeText: {
		padding: controlSize._4,
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
	},
	imageRow: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		gap: "0.625rem",
		borderWidth: 0,
		backgroundColor: "transparent",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		transitionProperty: "background-color",
		transitionDuration: "120ms",
	},
	imageRowIdle: {
		backgroundColor: {
			default: "transparent",
			":hover": "rgba(255, 255, 255, 0.03)",
		},
	},
	imageRowActive: {
		backgroundColor: "rgba(255, 255, 255, 0.06)",
	},
	thumbnail: {
		width: "2.5rem",
		height: "2.5rem",
		flexShrink: 0,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: 4,
		objectFit: "cover",
	},
	rowText: {
		minWidth: 0,
		flex: 1,
	},
	imageName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textSoft,
		fontSize: font.size_2,
	},
	imageMeta: {
		display: "flex",
		gap: controlSize._2,
		color: color.textMuted,
		fontSize: "0.625rem",
	},
	noShrink: {
		flexShrink: 0,
	},
	previewPane: {
		display: "flex",
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
		padding: controlSize._6,
	},
	previewContent: {
		display: "flex",
		width: "100%",
		height: "100%",
		flexDirection: "column",
		alignItems: "center",
		gap: controlSize._3,
	},
	previewImage: {
		maxWidth: "100%",
		maxHeight: "calc(100% - 3rem)",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: 8,
		objectFit: "contain",
	},
	previewMeta: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._3,
		color: color.textMuted,
		fontSize: font.size_2,
	},
	previewEmpty: {
		color: color.textMuted,
		fontSize: "0.75rem",
	},
});
