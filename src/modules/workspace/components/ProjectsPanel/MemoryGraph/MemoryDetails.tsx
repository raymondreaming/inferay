import {
	deleteMemoryItem,
	type MemoryGraphNode,
	readMemoryNote,
} from "@shared/services/memoryApi.ts";
import { Button } from "@shared/ui/Button/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createSignal, For, Show } from "solid-js";
import {
	openAgentPane,
	startAgentChatWithDraft,
} from "../../../hooks/useWorkspaceState.tsx";
import {
	continuationDraft,
	formatBytes,
	memoryKindLabel,
	memoryOriginLabel,
} from "../../../model/memoryGraph.ts";
import { projectDocumentUrl } from "../../../services/projectsApi.ts";
import { styles } from "./styles.ts";

export function MemoryDetails(props: {
	projectId: string;
	item: MemoryGraphNode | undefined;
	related: MemoryGraphNode[];
	chatTitle: (node: MemoryGraphNode) => string;
	chat: (
		node: MemoryGraphNode,
	) => { groupId: string; pane: { id: string } } | undefined;
	onPick: (id: string) => void;
	onDeleted: () => void;
}) {
	const [body, setBody] = createSignal("");
	const [confirming, setConfirming] = createSignal(false);
	const [problem, setProblem] = createSignal("");
	const [starting, setStarting] = createSignal(false);
	createEffect(
		() => (props.item?.kind === "note" ? props.item.id : null),
		(id) => {
			setConfirming(false);
			setProblem("");
			if (!id) return;
			setBody("");
			readMemoryNote({ projectId: props.projectId }, id)
				.then((result) => {
					if (props.item?.id === id) setBody(result.note.body);
				})
				.catch(() => {
					if (props.item?.id === id) setBody("This note could not be read.");
				});
		},
	);
	const remove = async (item: MemoryGraphNode) => {
		try {
			await deleteMemoryItem(
				props.projectId,
				item.kind === "note" ? { id: item.id } : { path: item.path },
			);
			setConfirming(false);
			props.onDeleted();
		} catch (error) {
			setProblem(error instanceof Error ? error.message : "Could not delete");
		}
	};
	const continueWithMemories = async (item: MemoryGraphNode) => {
		setStarting(true);
		try {
			const notes = await Promise.all(
				props.related
					.filter((n) => n.kind === "note")
					.slice(0, 8)
					.map((n) =>
						readMemoryNote({ projectId: props.projectId }, n.id)
							.then(
								(v) => `### ${n.title}\n${v.note.body.trim().slice(0, 3000)}`,
							)
							.catch(() => `### ${n.title}`),
					),
			);
			const files = props.related
				.filter((n) => n.kind === "image" || n.kind === "file")
				.map((n) => n.path);
			await startAgentChatWithDraft(
				continuationDraft(props.chatTitle(item), notes, files),
				() => {},
			);
		} finally {
			setStarting(false);
		}
	};
	return (
		<aside aria-label="Memory item" {...stylex.attrs(styles.panel)}>
			<Show
				when={props.item}
				fallback={
					<p {...stylex.attrs(styles.muted)}>
						Select anything on the graph to see it here.
					</p>
				}
				keyed
			>
				{(item) => (
					<>
						<Show when={item.kind === "image"}>
							<img
								src={projectDocumentUrl(props.projectId, item.path)}
								alt={item.title}
								{...stylex.attrs(styles.preview)}
							/>
						</Show>
						<div>
							<h2 {...stylex.attrs(styles.title)}>
								{item.kind === "source" ? props.chatTitle(item) : item.title}
							</h2>
							<span {...stylex.attrs(styles.muted)}>
								{memoryKindLabel(item)}
								{item.created ? ` · ${item.created.slice(0, 10)}` : ""}
								{item.size > 0 && item.kind !== "source"
									? ` · ${formatBytes(item.size)}`
									: ""}
							</span>
						</div>
						<Show when={item.kind === "note"}>
							<p {...stylex.attrs(styles.body)}>{body() || "Loading…"}</p>
						</Show>
						<Show when={item.kind !== "source"}>
							<dl {...stylex.attrs(styles.facts)}>
								<dt {...stylex.attrs(styles.factName)}>From</dt>
								<dd {...stylex.attrs(styles.factValue)}>
									{memoryOriginLabel(item)}
								</dd>
								<Show when={item.tags.length > 0}>
									<dt {...stylex.attrs(styles.factName)}>Tags</dt>
									<dd {...stylex.attrs(styles.factValue)}>
										{item.tags.map((t) => `#${t}`).join("  ")}
									</dd>
								</Show>
								<dt {...stylex.attrs(styles.factName)}>File</dt>
								<dd {...stylex.attrs(styles.factValue, styles.path)}>
									{item.path}
								</dd>
							</dl>
						</Show>
						<Show when={item.kind === "source"}>
							<div {...stylex.attrs(styles.sourceActions)}>
								<Show
									when={props.chat(item)}
									fallback={
										<p {...stylex.attrs(styles.muted)}>
											{item.source.startsWith("run:")
												? "Saved by an automation run."
												: "That chat has been closed."}
										</p>
									}
									keyed
								>
									{(chat) => (
										<Button
											size="sm"
											variant="primary"
											onClick={() => void openAgentPane(chat.pane.id, () => {})}
										>
											Open chat
										</Button>
									)}
								</Show>
								<Button
									size="sm"
									variant="ghost"
									disabled={starting()}
									onClick={() => void continueWithMemories(item)}
								>
									{starting() ? "Starting…" : "New chat with these memories"}
								</Button>
							</div>
						</Show>
						<Show when={props.related.length > 0}>
							<section {...stylex.attrs(styles.section)}>
								<h3 {...stylex.attrs(styles.sectionTitle)}>
									{item.kind === "source" ? "Saved from here" : "Connected"}
								</h3>
								<For each={props.related}>
									{(other) => (
										<button
											type="button"
											{...stylex.attrs(styles.relation)}
											onClick={() => props.onPick(other.id)}
										>
											{other.kind === "source"
												? props.chatTitle(other)
												: other.title}
										</button>
									)}
								</For>
							</section>
						</Show>
						<Show when={item.kind === "file"}>
							<a
								href={projectDocumentUrl(props.projectId, item.path)}
								target="_blank"
								rel="noreferrer"
								{...stylex.attrs(styles.link)}
							>
								Open file
							</a>
						</Show>
						<Show when={item.kind !== "source"}>
							<div {...stylex.attrs(styles.actions)}>
								<Show
									when={confirming()}
									fallback={
										<Button
											size="sm"
											variant="ghost"
											onClick={() => setConfirming(true)}
										>
											Delete
										</Button>
									}
								>
									<p {...stylex.attrs(styles.confirm)}>
										Remove “{item.title}” from memory? This deletes the file.
									</p>
									<Button
										size="sm"
										variant="danger"
										onClick={() => void remove(item)}
									>
										Delete
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setConfirming(false)}
									>
										Cancel
									</Button>
								</Show>
								<Show when={problem()}>
									<p role="alert" {...stylex.attrs(styles.muted)}>
										{problem()}
									</p>
								</Show>
							</div>
						</Show>
					</>
				)}
			</Show>
		</aside>
	);
}
