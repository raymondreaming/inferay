import { listDirectory } from "@explorer/services/explorerApi.ts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconChevronRight, IconFileDiff } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";
import { readProjectFile } from "../../services/projectsApi.ts";
import { LibraryToolbar } from "./LibraryToolbar.tsx";
import { styles } from "./styles.ts";

export function ProjectFiles(props: { directory: string; root: string }) {
	const [search, setSearch] = createSignal("");
	const [path, setPath] = createSignal(props.root);
	const [selected, setSelected] = createSignal<string | null>(null);
	const files = useBackgroundQuery(
		() => ({
			queryKey: ["project-files", props.directory, path()],
			queryFn: ({ signal }) => listDirectory(props.directory, path(), signal),
		}),
		() => queryClient,
	);
	const preview = useBackgroundQuery(
		() => ({
			queryKey: ["project-file-preview", props.directory, selected()],
			enabled: !!selected(),
			queryFn: () => readProjectFile(props.directory, selected()!),
		}),
		() => queryClient,
	);
	return (
		<section aria-label="Project files" {...stylex.attrs(styles.list)}>
			<LibraryToolbar label="Search Files" value={search()} onInput={setSearch}>
				{path() !== props.root ? (
					<Button
						size="sm"
						onClick={() => {
							setPath(path().split("/").slice(0, -1).join("/") || props.root);
							setSelected(null);
						}}
					>
						Back
					</Button>
				) : null}
				<span {...stylex.attrs(styles.muted)}>
					{path() === props.root
						? "Saved files"
						: path().slice(props.root.length + 1)}
				</span>
				<Button size="sm" onClick={() => void files.refetch()}>
					Refresh files
				</Button>
			</LibraryToolbar>
			{files.error ? <p role="alert">{String(files.error)}</p> : null}
			{files.isPending ? <p>Loading files…</p> : null}
			{files.data?.length === 0 ? (
				<p {...stylex.attrs(styles.muted)}>No files saved here yet.</p>
			) : null}
			<For
				each={(files.data ?? []).filter((file) =>
					file.name.toLowerCase().includes(search().toLowerCase()),
				)}
				keyed={(file) => file.path}
			>
				{(file) => (
					<button
						type="button"
						{...stylex.attrs(styles.projectRow)}
						onClick={() => {
							if (file().isDir) {
								setPath(file().path);
								setSelected(null);
							} else setSelected(file().path);
						}}
					>
						<IconFileDiff size={16} />
						<span {...stylex.attrs(styles.listText)}>{file().name}</span>
						{file().isDir ? <IconChevronRight size={15} /> : null}
					</button>
				)}
			</For>
			{selected() ? (
				<article {...stylex.attrs(styles.card)}>
					<div {...stylex.attrs(styles.row)}>
						<strong>{selected()!.split("/").at(-1)}</strong>
						<Button size="sm" onClick={() => setSelected(null)}>
							Close preview
						</Button>
					</div>
					{preview.error ? (
						<p role="alert">{String(preview.error)}</p>
					) : (
						<pre {...stylex.attrs(styles.pre)}>
							{preview.data?.content ?? "Loading…"}
						</pre>
					)}
				</article>
			) : null}
		</section>
	);
}
