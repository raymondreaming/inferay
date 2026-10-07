import { Markdown } from "@conversation/components/ChatRichContent/Markdown.tsx";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";
import {
	projectImageUrl,
	projectVideoUrl,
	readProjectFile,
} from "../../services/projectsApi.ts";
import { styles } from "./styles.ts";

export function RunFilePreview(props: {
	directory: string;
	path: string;
	close: () => void;
}) {
	const image = () => /\.(png|jpe?g|webp|gif|ico|bmp|svg)$/i.test(props.path);
	const markdown = () => /\.(md|markdown)$/i.test(props.path);
	const video = () => /\.(mp4|m4v|webm|mov|ogv)$/i.test(props.path);
	const [mediaError, setMediaError] = createSignal(false);
	const [loaded, setLoaded] = createSignal(false);
	const [source, setSource] = createSignal(false);
	const file = useBackgroundQuery(
		() => ({
			queryKey: ["run-file", props.directory, props.path],
			enabled: !image() && !video(),
			queryFn: ({ signal }: { signal: AbortSignal }) =>
				readProjectFile(props.directory, props.path, signal),
		}),
		() => queryClient,
	);
	return (
		<section aria-label="Run output preview" {...stylex.attrs(styles.card)}>
			<div {...stylex.attrs(styles.row)}>
				<strong>{props.path}</strong>
				<Show when={file.data && (file.data.table || markdown())}>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => setSource(!source())}
					>
						{source()
							? markdown()
								? "View report"
								: "View table"
							: "View source"}
					</Button>
				</Show>
				<Button size="sm" variant="ghost" onClick={props.close}>
					Close preview
				</Button>
			</div>
			{video() ? (
				<>
					{mediaError() && (
						<p role="alert">
							This video could not be played. Its format may be unsupported, or
							the file may exceed the 50 MB preview limit.
						</p>
					)}
					{/* oxlint-disable-next-line jsx-a11y/media-has-caption -- Run artifacts may have no caption track; this viewer preserves the original media. */}
					<video
						aria-label={props.path}
						src={projectVideoUrl(props.directory, props.path)}
						controls
						playsinline
						preload="metadata"
						onError={() => setMediaError(true)}
						{...stylex.attrs(styles.runPreviewImage, styles.runPreviewVideo)}
					/>
				</>
			) : image() ? (
				<>
					{!loaded() && !mediaError() && <p role="status">Loading image…</p>}
					{mediaError() && (
						<p role="alert">
							This image could not be displayed. It may be missing or
							unsupported.
						</p>
					)}
					<img
						src={projectImageUrl(props.directory, props.path)}
						alt={props.path}
						onLoad={() => setLoaded(true)}
						onError={() => setMediaError(true)}
						{...stylex.attrs(styles.runPreviewImage)}
					/>
				</>
			) : (
				<>
					{file.isPending && <p role="status">Loading file…</p>}
					{file.error && <p role="alert">{String(file.error)}</p>}
					{file.data?.tableError && <p role="status">{file.data.tableError}</p>}
					<Show
						when={!source() && file.data?.table}
						fallback={
							file.data &&
							(markdown() && !source() ? (
								<Markdown text={file.data.content} />
							) : (
								<pre {...stylex.attrs(styles.pre)}>{file.data.content}</pre>
							))
						}
					>
						{(table) => (
							<>
								<p {...stylex.attrs(styles.muted)}>
									{table().rows.length < table().totalRows
										? `Showing ${table().rows.length} of ${table().totalRows} rows`
										: `${table().totalRows} rows`}
								</p>
								<div {...stylex.attrs(styles.runTableScroll)}>
									<table
										aria-label={props.path}
										{...stylex.attrs(styles.runTable)}
									>
										<thead>
											<tr>
												<For each={table().columns}>
													{(column) => (
														<th
															scope="col"
															{...stylex.attrs(styles.runTableHeader)}
														>
															{column}
														</th>
													)}
												</For>
											</tr>
										</thead>
										<tbody>
											<For each={table().rows}>
												{(row) => (
													<tr>
														<For each={row}>
															{(cell) => (
																<td {...stylex.attrs(styles.runTableCell)}>
																	{cell}
																</td>
															)}
														</For>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</div>
							</>
						)}
					</Show>
				</>
			)}
		</section>
	);
}
