import type { MemoryHit } from "@contracts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import {
	readMemoryNote,
	saveMemoryNote,
	searchMemory,
} from "@shared/services/memoryApi.ts";
import { Button } from "@shared/ui/Button/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";
import { LibraryToolbar } from "../LibraryToolbar.tsx";
import { styles } from "./styles.ts";

const day = (value: string) => value.slice(0, 10);
const sourceLabel = (source: string) =>
	source.startsWith("chat:")
		? "Chat"
		: source.startsWith("run:")
			? "Run"
			: source === "agent"
				? "Agent"
				: "Manual";

/** The project's long-term memory: notes saved from chats, runs and by hand. */
export function MemoryPanel(props: { projectId: string }) {
	const [query, setQuery] = createSignal("");
	const [tag, setTag] = createSignal("");
	const [selected, setSelected] = createSignal<string | null>(null);
	const [composing, setComposing] = createSignal(false);
	const scope = () => ({ projectId: props.projectId });
	const notes = useBackgroundQuery(
		() => ({
			queryKey: ["project-memory", props.projectId, query(), tag()],
			queryFn: () => searchMemory(scope(), query(), tag()),
		}),
		() => queryClient,
	);
	const note = useBackgroundQuery(
		() => ({
			queryKey: ["project-memory-note", props.projectId, selected()],
			enabled: !!selected(),
			queryFn: () => readMemoryNote(scope(), selected()!),
		}),
		() => queryClient,
	);
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["project-memory"] });

	return (
		<section aria-label="Project memory" {...stylex.attrs(styles.panel)}>
			<LibraryToolbar label="Search memory" value={query()} onInput={setQuery}>
				{tag() ? (
					<Button size="sm" variant="ghost" onClick={() => setTag("")}>
						#{tag()} ✕
					</Button>
				) : null}
				<span {...stylex.attrs(styles.muted)}>
					{notes.data
						? `${notes.data.listing.total} ${notes.data.listing.total === 1 ? "note" : "notes"}`
						: ""}
				</span>
				<Button
					size="sm"
					onClick={() => {
						setSelected(null);
						setComposing(true);
					}}
				>
					New note
				</Button>
			</LibraryToolbar>
			{notes.error ? <p role="alert">{String(notes.error)}</p> : null}
			<For each={notes.data?.listing.errors ?? []}>
				{(message) => <p {...stylex.attrs(styles.error)}>⚠️ {message}</p>}
			</For>
			{composing() ? (
				<NoteForm
					projectId={props.projectId}
					close={(id) => {
						setComposing(false);
						void refresh();
						if (id) setSelected(id);
					}}
				/>
			) : selected() ? (
				<NoteView
					view={note.data}
					loading={note.isPending}
					back={() => setSelected(null)}
					open={setSelected}
					filter={(value) => {
						setSelected(null);
						setTag(value);
					}}
				/>
			) : notes.data?.listing.hits.length === 0 ? (
				<p {...stylex.attrs(styles.muted)}>
					{query() || tag()
						? "Nothing in memory matches."
						: "Nothing saved yet. Use Memory on a chat message, ask an agent to save a note, or add one here."}
				</p>
			) : (
				<NoteTable
					hits={notes.data?.listing.hits ?? []}
					open={setSelected}
					filter={setTag}
				/>
			)}
		</section>
	);
}

function Tags(props: { tags: string[]; filter: (tag: string) => void }) {
	return (
		<span {...stylex.attrs(styles.tags)}>
			<For each={props.tags}>
				{(tag) => (
					<button
						type="button"
						{...stylex.attrs(styles.tag)}
						onClick={(event) => {
							event.stopPropagation();
							props.filter(tag);
						}}
					>
						#{tag}
					</button>
				)}
			</For>
		</span>
	);
}

function NoteTable(props: {
	hits: MemoryHit[];
	open: (id: string) => void;
	filter: (tag: string) => void;
}) {
	return (
		<table {...stylex.attrs(styles.table)}>
			<thead>
				<tr>
					<th {...stylex.attrs(styles.headCell)}>Note</th>
					<th {...stylex.attrs(styles.headCell)}>Tags</th>
					<th {...stylex.attrs(styles.headCell)}>From</th>
					<th {...stylex.attrs(styles.headCell)}>Saved</th>
				</tr>
			</thead>
			<tbody>
				<For each={props.hits} keyed={(hit) => hit.id}>
					{(hit) => (
						<tr
							{...stylex.attrs(
								styles.row,
								(hit().superseded || hit().expired) && styles.stale,
							)}
							onClick={() => props.open(hit().id)}
						>
							<td {...stylex.attrs(styles.cell)}>
								<div {...stylex.attrs(styles.title)}>
									{hit().title}
									{hit().superseded ? (
										<span {...stylex.attrs(styles.badge)}>superseded</span>
									) : null}
									{hit().expired ? (
										<span {...stylex.attrs(styles.badge)}>expired</span>
									) : null}
								</div>
								<div {...stylex.attrs(styles.snippet)}>{hit().snippet}</div>
							</td>
							<td {...stylex.attrs(styles.cell)}>
								<Tags tags={hit().tags} filter={props.filter} />
							</td>
							<td {...stylex.attrs(styles.cell, styles.muted)}>
								{sourceLabel(hit().source)}
							</td>
							<td {...stylex.attrs(styles.cell, styles.muted)}>
								{day(hit().created)}
							</td>
						</tr>
					)}
				</For>
			</tbody>
		</table>
	);
}

function NoteView(props: {
	view: Awaited<ReturnType<typeof readMemoryNote>> | undefined;
	loading: boolean;
	back: () => void;
	open: (id: string) => void;
	filter: (tag: string) => void;
}) {
	const related = (label: string, hits: MemoryHit[]) =>
		hits.length ? (
			<div {...stylex.attrs(styles.links)}>
				<span {...stylex.attrs(styles.muted)}>{label}</span>
				<For each={hits} keyed={(hit) => hit.id}>
					{(hit) => (
						<Button
							size="sm"
							variant="ghost"
							onClick={() => props.open(hit().id)}
						>
							{hit().title}
						</Button>
					)}
				</For>
			</div>
		) : null;
	return (
		<article {...stylex.attrs(styles.note)}>
			<div {...stylex.attrs(styles.links)}>
				<Button size="sm" onClick={props.back}>
					Back
				</Button>
			</div>
			{props.loading || !props.view ? (
				<p {...stylex.attrs(styles.muted)}>Loading note…</p>
			) : (
				<>
					<h3 {...stylex.attrs(styles.title)}>{props.view.note.title}</h3>
					<div {...stylex.attrs(styles.links)}>
						<Tags tags={props.view.note.tags} filter={props.filter} />
						<span {...stylex.attrs(styles.muted)}>
							{sourceLabel(props.view.note.source)} ·{" "}
							{day(props.view.note.created)} · {props.view.path}
						</span>
					</div>
					{props.view.supersededBy ? (
						<div {...stylex.attrs(styles.links)}>
							<span {...stylex.attrs(styles.muted)}>Superseded by</span>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => props.open(props.view!.supersededBy!)}
							>
								newer note
							</Button>
						</div>
					) : null}
					<div {...stylex.attrs(styles.body)}>{props.view.note.body}</div>
					{related("Links to", props.view.linksOut)}
					{related("Linked from", props.view.linksIn)}
				</>
			)}
		</article>
	);
}

function NoteForm(props: { projectId: string; close: (id?: string) => void }) {
	const [title, setTitle] = createSignal("");
	const [tags, setTags] = createSignal("");
	const [body, setBody] = createSignal("");
	const [problem, setProblem] = createSignal("");
	const [saving, setSaving] = createSignal(false);
	const save = async () => {
		setSaving(true);
		setProblem("");
		try {
			const result = await saveMemoryNote(
				{ projectId: props.projectId },
				{
					title: title(),
					body: body(),
					tags: tags()
						.split(",")
						.map((tag) => tag.trim())
						.filter(Boolean),
					source: "manual",
					supersedes: null,
					expires: null,
				},
			);
			props.close(result.note.id);
		} catch (error) {
			setProblem(error instanceof Error ? error.message : "Could not save");
		} finally {
			setSaving(false);
		}
	};
	return (
		<form
			{...stylex.attrs(styles.form)}
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<TextInput
				placeholder="Title"
				value={title()}
				onInput={(event) => setTitle(event.currentTarget.value)}
				fullWidth
			/>
			<TextInput
				placeholder="Tags, separated by commas"
				value={tags()}
				onInput={(event) => setTags(event.currentTarget.value)}
				fullWidth
			/>
			<textarea
				aria-label="Note"
				placeholder="What should this project remember? Markdown and [[links]] to other notes work."
				value={body()}
				onInput={(event) => setBody(event.currentTarget.value)}
				{...stylex.attrs(styles.textarea)}
			/>
			{problem() ? <p role="alert">{problem()}</p> : null}
			<div {...stylex.attrs(styles.links)}>
				<Button
					size="sm"
					variant="primary"
					type="submit"
					disabled={saving() || !title().trim() || !body().trim()}
				>
					Save to memory
				</Button>
				<Button size="sm" variant="ghost" onClick={() => props.close()}>
					Cancel
				</Button>
			</div>
		</form>
	);
}
