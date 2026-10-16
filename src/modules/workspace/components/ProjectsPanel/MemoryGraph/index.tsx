import type { MemoryGraphNode } from "@contracts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { readStoredValue } from "@shared/lib/native.tsx";
import { loadMemoryGraph, searchMemory } from "@shared/services/memoryApi.ts";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
	Show,
} from "solid-js";
import { findAgentPane } from "../../../hooks/useWorkspaceState.tsx";
import {
	clampZoom,
	layoutMemoryGraph,
	type MemoryCategory,
	memoryCategory,
} from "../../../model/memoryGraph.ts";
import { GraphFilters, ZoomControls } from "./GraphControls.tsx";
import { MemoryDetails } from "./MemoryDetails.tsx";
import { MemoryNode } from "./MemoryNode.tsx";
import { styles } from "./styles.ts";
import { useMemoryDrop } from "./useMemoryDrop.ts";

type View = { x: number; y: number; k: number };

export function MemoryGraph(props: { projectId: string }) {
	const [selected, setSelected] = createSignal<string | null>(null);
	const [hovered, setHovered] = createSignal<string | null>(null);
	const [view, setView] = createSignal<View>({ x: 0, y: 0, k: 1 });
	const [animate, setAnimate] = createSignal(false);
	const [size, setSize] = createSignal({ w: 800, h: 600 });
	const [dragging, setDragging] = createSignal(false);
	const [category, setCategory] = createSignal<MemoryCategory>("all");
	const [query, setQuery] = createSignal("");
	const [matches, setMatches] = createSignal<Set<string> | null>(null);
	const graph = useBackgroundQuery(() => ({
		queryKey: ["project-memory-graph", props.projectId],
		queryFn: () => loadMemoryGraph(props.projectId),
	}));
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["project-memory-graph"] });
	const positions = createMemo(() => {
		const data = graph.data;
		return data
			? layoutMemoryGraph(data.nodes, data.edges)
			: new Map<string, { x: number; y: number }>();
	});

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	createEffect(
		() => query().trim(),
		(q) => {
			clearTimeout(searchTimer);
			if (!q) return void setMatches(null);
			searchTimer = setTimeout(() => {
				searchMemory({ projectId: props.projectId }, q)
					.then((result) => {
						if (query().trim() !== q) return;
						const ids = new Set(result.listing.hits.map((h) => h.id));
						const needle = q.toLowerCase();
						for (const n of graph.data?.nodes ?? [])
							if (n.kind !== "source" && n.title.toLowerCase().includes(needle))
								ids.add(n.id);
						setMatches(ids);
					})
					.catch(() => setMatches(new Set<string>()));
			}, 180);
		},
	);

	const allNodes = () => graph.data?.nodes ?? [];
	const nodes = createMemo(() => {
		let list =
			category() === "all"
				? allNodes()
				: allNodes().filter((n) => memoryCategory(n) === category());
		const found = matches();
		if (found) {
			const keep = new Set(found);
			for (const edge of graph.data?.edges ?? [])
				if (edge.kind === "source" && found.has(edge.from)) keep.add(edge.to);
			list = list.filter((n) => keep.has(n.id));
		}
		return list;
	});
	const counts = createMemo(() => {
		const out: Record<MemoryCategory, number> = {
			all: 0,
			text: 0,
			images: 0,
			files: 0,
			chats: 0,
		};
		for (const n of allNodes()) {
			out[memoryCategory(n)]++;
			if (n.kind !== "source") out.all++;
		}
		return out;
	});
	const byId = createMemo(() => new Map(nodes().map((n) => [n.id, n])));
	const neighbours = createMemo(() => {
		const map = new Map<string, Set<string>>();
		for (const edge of graph.data?.edges ?? []) {
			if (!map.has(edge.from)) map.set(edge.from, new Set());
			if (!map.has(edge.to)) map.set(edge.to, new Set());
			map.get(edge.from)!.add(edge.to);
			map.get(edge.to)!.add(edge.from);
		}
		return map;
	});
	const focus = () => hovered() ?? selected();
	const edges = createMemo(() =>
		(graph.data?.edges ?? []).filter(
			(edge) =>
				byId().has(edge.from) &&
				byId().has(edge.to) &&
				positions().has(edge.from) &&
				positions().has(edge.to),
		),
	);
	const selection = () => {
		const id = selected();
		return id ? byId().get(id) : undefined;
	};
	const related = () => {
		const s = selection();
		if (!s) return [];
		return [...(neighbours().get(s.id) ?? [])]
			.map((id) => byId().get(id))
			.filter((n): n is MemoryGraphNode => !!n);
	};

	const chatOf = (node: MemoryGraphNode) =>
		node.source.startsWith("chat:")
			? findAgentPane(node.source.slice(5))
			: undefined;
	const chatTitle = (node: MemoryGraphNode) => {
		if (node.source.startsWith("run:")) return "Automation run";
		return (
			chatOf(node)?.pane.summary?.trim() ||
			readStoredValue(`inferay-chat-summary-${node.source.slice(5)}`)?.trim() ||
			"Chat"
		);
	};
	const labelFor = (node: MemoryGraphNode) => {
		const text = node.kind === "source" ? chatTitle(node) : node.title;
		const short = text.length > 30 ? `${text.slice(0, 28)}…` : text;
		return node.kind === "source" ? `${short} · ${node.size}` : short;
	};

	let stage: HTMLDivElement | undefined;
	let drag: {
		x: number;
		y: number;
		vx: number;
		vy: number;
		moved: boolean;
	} | null = null;
	const measure = () => {
		if (stage) setSize({ w: stage.clientWidth, h: stage.clientHeight });
	};
	onSettled(() => {
		const observer = new ResizeObserver(measure);
		if (stage) observer.observe(stage);
		return () => observer.disconnect();
	});
	const moveTo = (next: View, smooth: boolean) => {
		if (smooth) {
			setAnimate(true);
			setTimeout(() => setAnimate(false), 240);
		}
		setView(next);
	};
	const zoomTo = (k: number, px = 0, py = 0, smooth = false) => {
		const v = view();
		const next = clampZoom(k);
		moveTo(
			{
				k: next,
				x: px - ((px - v.x) * next) / v.k,
				y: py - ((py - v.y) * next) / v.k,
			},
			smooth,
		);
	};
	const fitView = (smooth: boolean) => {
		const points = nodes()
			.map((n) => positions().get(n.id))
			.filter((p): p is { x: number; y: number } => !!p);
		if (!points.length || size().w < 50) return;
		const xs = points.map((p) => p.x);
		const ys = points.map((p) => p.y);
		const minX = Math.min(...xs) - 120;
		const maxX = Math.max(...xs) + 120;
		const minY = Math.min(...ys) - 30;
		const maxY = Math.max(...ys) + 50;
		const k = clampZoom(
			Math.min(
				2.2,
				(size().w * 0.85) / (maxX - minX),
				(size().h * 0.8) / (maxY - minY),
			),
		);
		moveTo(
			{ k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k },
			smooth,
		);
	};
	let fitted = "";
	createEffect(
		() => [positions(), size()] as const,
		([points, box]) => {
			const key = `${props.projectId}:${points.size}`;
			if (fitted === key || box.w < 50) return;
			fitted = key;
			fitView(false);
		},
	);
	const groupStyle = () => {
		const v = view();
		const ease = animate()
			? "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)"
			: "none";
		return `transform: translate(${size().w / 2 + v.x}px, ${size().h / 2 + v.y}px) scale(${v.k}); transition: ${ease}`;
	};
	const gridStyle = () => {
		const v = view();
		const step = Math.max(8, 24 * v.k);
		return `background-size: ${step}px ${step}px; background-position: ${size().w / 2 + v.x}px ${size().h / 2 + v.y}px`;
	};

	const { dropping, setDropping, adding, addToMemory } = useMemoryDrop(
		() => props.projectId,
		refresh,
	);

	return (
		<div {...stylex.attrs(styles.layout)}>
			<div
				ref={(el) => {
					stage = el;
				}}
				{...stylex.attrs(styles.stage, dragging() && styles.grabbing)}
				style={gridStyle()}
				onDragOver={(event) => {
					event.preventDefault();
					setDropping(true);
				}}
				onDragLeave={(event) => {
					if (
						!(event.currentTarget as HTMLElement).contains(
							event.relatedTarget as Node,
						)
					)
						setDropping(false);
				}}
				onDrop={(event) => {
					event.preventDefault();
					setDropping(false);
					void addToMemory(
						[...(event.dataTransfer?.files ?? [])],
						event.dataTransfer?.getData("text/plain") ?? "",
					);
				}}
				onPointerDown={(event) => {
					if (
						(event.target as Element).closest(
							"[data-memory-node], [data-memory-controls]",
						)
					)
						return;
					measure();
					drag = {
						x: event.clientX,
						y: event.clientY,
						vx: view().x,
						vy: view().y,
						moved: false,
					};
					(event.currentTarget as HTMLElement).setPointerCapture(
						event.pointerId,
					);
				}}
				onPointerMove={(event) => {
					if (!drag) return;
					const dx = event.clientX - drag.x;
					const dy = event.clientY - drag.y;
					if (Math.abs(dx) + Math.abs(dy) > 3) {
						drag.moved = true;
						setDragging(true);
					}
					if (drag.moved)
						setView({ ...view(), x: drag.vx + dx, y: drag.vy + dy });
				}}
				onPointerUp={() => {
					if (drag && !drag.moved) setSelected(null);
					drag = null;
					setDragging(false);
				}}
				onWheel={(event) => {
					event.preventDefault();
					const rect = (
						event.currentTarget as HTMLElement
					).getBoundingClientRect();
					zoomTo(
						view().k * Math.exp(-event.deltaY * 0.0015),
						event.clientX - rect.left - size().w / 2,
						event.clientY - rect.top - size().h / 2,
					);
				}}
			>
				<svg {...stylex.attrs(styles.svg)} role="img" aria-label="Memory graph">
					<g style={groupStyle()}>
						<For
							each={edges()}
							keyed={(edge) => `${edge.kind}:${edge.from}>${edge.to}`}
						>
							{(edge) => (
								<line
									x1={positions().get(edge().from)?.x}
									y1={positions().get(edge().from)?.y}
									x2={positions().get(edge().to)?.x}
									y2={positions().get(edge().to)?.y}
									{...stylex.attrs(
										focus() === edge().from || focus() === edge().to
											? styles.edgeActive
											: edge().kind === "source"
												? styles.edge
												: styles.edgeLink,
									)}
								/>
							)}
						</For>
						<For each={nodes()} keyed={(node) => node.id}>
							{(node, index) => (
								<MemoryNode
									node={node()}
									index={index()}
									point={positions().get(node().id)}
									degree={neighbours().get(node().id)?.size ?? 0}
									active={node().id === selected() || node().id === hovered()}
									chosen={node().id === selected()}
									projectId={props.projectId}
									zoom={view().k}
									showLabel={
										node().id === selected() ||
										node().id === hovered() ||
										!!neighbours()
											.get(focus() ?? "")
											?.has(node().id) ||
										nodes().length <= 80 ||
										view().k >= 1.6
									}
									label={labelFor(node())}
									tooltip={
										node().kind === "source" ? chatTitle(node()) : node().title
									}
									onHover={setHovered}
									onPick={setSelected}
								/>
							)}
						</For>
					</g>
				</svg>
				<Show when={matches() && nodes().length === 0}>
					<div {...stylex.attrs(styles.empty)}>
						Nothing in memory matches “{query()}”.
					</div>
				</Show>
				<Show when={graph.data && graph.data.nodes.length === 0}>
					<div {...stylex.attrs(styles.empty)}>
						Nothing in memory yet. Save a chat message, or drop or paste
						anything here.
					</div>
				</Show>
				<Show when={graph.data && graph.data.nodes.length > 0}>
					<GraphFilters
						query={query()}
						onQuery={setQuery}
						onOpenFirst={() => {
							const first = nodes().find((n) => n.kind !== "source");
							if (first) setSelected(first.id);
						}}
						category={category()}
						counts={counts()}
						onCategory={(value) => {
							setCategory(value);
							setSelected(null);
						}}
						truncated={!!graph.data?.truncated}
					/>
				</Show>
				<ZoomControls
					zoom={view().k}
					onZoom={(factor) => zoomTo(view().k * factor, 0, 0, true)}
					onReset={() => zoomTo(1, 0, 0, true)}
					onFit={() => fitView(true)}
				/>
				<Show when={dropping()}>
					<div {...stylex.attrs(styles.dropOverlay)}>
						Drop to save to Memory
					</div>
				</Show>
				<Show when={adding()}>
					<div role="status" {...stylex.attrs(styles.toast)}>
						{adding()}
					</div>
				</Show>
				<div {...stylex.attrs(styles.hint)}>
					Scroll to zoom · drag to move · drop or paste anything to save it
				</div>
			</div>
			<MemoryDetails
				projectId={props.projectId}
				item={selection()}
				related={related()}
				chatTitle={chatTitle}
				chat={chatOf}
				onPick={setSelected}
				onDeleted={() => {
					setSelected(null);
					void refresh();
					void queryClient.invalidateQueries({ queryKey: ["project-memory"] });
				}}
			/>
		</div>
	);
}
