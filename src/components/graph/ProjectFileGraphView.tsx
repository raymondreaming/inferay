import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";
import type { GitProjectStatus } from "../../features/git/types.ts";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import { hasId, hasPath } from "../../lib/data.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import { DropdownButton } from "../ui/DropdownButton.tsx";
import {
	IconFolder,
	IconGitBranch,
	ProjectGraphConnectionsLayer,
} from "../ui/Icons.tsx";

interface FileSearchEntry {
	readonly name: string;
	readonly path: string;
	readonly isDir: boolean;
}

interface FileGraphNode {
	readonly id: string;
	readonly label: string;
	readonly path: string;
	readonly x: number;
	readonly y: number;
	readonly status: "normal" | "modified" | "added";
	readonly connections: readonly string[];
}

function cwdLabel(cwd: string) {
	const parts = cwd.split("/");
	return parts[parts.length - 1] || cwd;
}

function fileStatusType(
	project: GitProjectStatus | null,
	path: string
): FileGraphNode["status"] {
	const file = project?.files.find(hasPath.bind(null, path));
	if (!file) return "normal";
	if (file.status === "?" || file.status === "A") return "added";
	return "modified";
}

function statusNodeStyle(status: FileGraphNode["status"]) {
	if (status === "added") return styles.nodeAdded;
	if (status === "modified") return styles.nodeModified;
	return styles.nodeNormal;
}

function statusDotStyle(status: FileGraphNode["status"]) {
	if (status === "added") return styles.dotAdded;
	if (status === "modified") return styles.dotModified;
	return styles.dotNormal;
}

function buildGraphNodes(
	project: GitProjectStatus | null,
	files: readonly FileSearchEntry[]
): FileGraphNode[] {
	const fileEntries = files.filter((entry) => !entry.isDir).slice(0, 32);
	if (fileEntries.length === 0) return [];

	const byDir = new Map<string, FileSearchEntry[]>();
	for (const file of fileEntries) {
		const dir = file.path.includes("/")
			? file.path.split("/").slice(0, -1).join("/")
			: ".";
		const bucket = byDir.get(dir) ?? [];
		bucket.push(file);
		byDir.set(dir, bucket);
	}

	const dirEntries = [...byDir.entries()].sort((a, b) =>
		a[0].localeCompare(b[0])
	);
	const nodes: FileGraphNode[] = [];
	const nodeMap = new Map<string, FileGraphNode>();

	dirEntries.forEach(([_dir, dirFiles], groupIndex) => {
		dirFiles.sort((a, b) => a.path.localeCompare(b.path));
		dirFiles.forEach((file, index) => {
			const column = groupIndex % 4;
			const columnGroup = Math.floor(groupIndex / 4);
			const x = 56 + column * 190 + (index % 2) * 18;
			const y = 48 + columnGroup * 210 + index * 52;
			const stem = file.name.replace(/\.[^.]+$/, "");
			const status = fileStatusType(project, file.path);

			const connections = new Set<string>();
			for (const other of dirFiles) {
				if (other.path !== file.path) connections.add(other.path);
			}
			for (const other of fileEntries) {
				if (other.path === file.path) continue;
				const otherStem = other.name.replace(/\.[^.]+$/, "");
				if (
					otherStem === stem ||
					(otherStem.startsWith(stem) && stem.length > 2) ||
					(stem.startsWith(otherStem) && otherStem.length > 2)
				) {
					connections.add(other.path);
				}
			}

			const node: FileGraphNode = {
				id: file.path,
				label: file.name,
				path: file.path,
				x,
				y,
				status,
				connections: [...connections].slice(0, 5),
			};
			nodes.push(node);
			nodeMap.set(node.id, node);
		});
	});

	return nodes.filter((node) => nodeMap.has(node.id));
}

export function ProjectFileGraphView({
	cwds,
	activeCwd,
	onSelectCwd,
	project,
}: {
	cwds: string[];
	activeCwd: string | null;
	onSelectCwd: (cwd: string) => void;
	project: GitProjectStatus | null;
}) {
	const { data: files, loading } = useAsyncResource<FileSearchEntry[]>(
		async () => {
			if (!activeCwd) return [];
			const response = await fetch(
				`/api/files/search?cwd=${encodeURIComponent(activeCwd)}&limit=50`
			);
			const data = (await response.json()) as { results?: FileSearchEntry[] };
			return data.results ?? [];
		},
		[],
		[activeCwd]
	);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

	const nodes = useMemo(
		() => buildGraphNodes(project, files),
		[project, files]
	);
	const selectedNode =
		nodes.find(hasId.bind(null, selectedNodeId)) ?? nodes[0] ?? null;
	const selectedConnections = useMemo(
		() =>
			selectedNode
				? nodes.filter((node) => selectedNode.connections.includes(node.id))
				: [],
		[nodes, selectedNode]
	);

	if (!activeCwd) {
		return (
			<div {...stylex.props(styles.noProject)}>
				<p {...stylex.props(styles.noProjectText)}>
					Open a project directory in one of this group's panes to populate the
					file graph.
				</p>
			</div>
		);
	}

	return (
		<div {...stylex.props(styles.root)}>
			<div {...stylex.props(styles.canvasPane)}>
				<div {...stylex.props(styles.gridBackdrop)} />
				<div {...stylex.props(styles.canvasControls)}>
					<DropdownButton
						value={activeCwd}
						options={cwds.map((cwd) => ({
							id: cwd,
							label: cwdLabel(cwd),
							detail: cwd,
							icon: <IconFolder size={12} />,
						}))}
						onChange={onSelectCwd}
						minWidth={220}
						buttonClassName={stylex.props(styles.dropdownButton).className}
						labelClassName={stylex.props(styles.dropdownLabel).className}
					/>
					{project ? (
						<div {...stylex.props(styles.branchPill)}>
							<IconGitBranch size={11} />
							<span {...stylex.props(styles.monoText)}>{project.branch}</span>
						</div>
					) : null}
				</div>
				<div {...stylex.props(styles.canvasScroll)}>
					{loading ? (
						<div {...stylex.props(styles.centerState)}>
							<p {...stylex.props(styles.centerText)}>
								Loading project files...
							</p>
						</div>
					) : nodes.length === 0 ? (
						<div {...stylex.props(styles.centerState)}>
							<p {...stylex.props(styles.centerText)}>
								No files available for this project yet.
							</p>
						</div>
					) : (
						<div {...stylex.props(styles.graphStage)}>
							<ProjectGraphConnectionsLayer
								className={stylex.props(styles.connectionsLayer).className}
								nodes={nodes}
								hoveredNodeId={hoveredNodeId}
								selectedNodeId={selectedNodeId}
							/>
							{nodes.map((node) => {
								const selected = node.id === selectedNodeId;
								return (
									<button
										type="button"
										key={node.id}
										{...stylex.props(
											styles.nodeButton,
											selected
												? [styles.nodeSelected, statusNodeStyle(node.status)]
												: styles.nodeIdle
										)}
										style={{ left: node.x, top: node.y }}
										onClick={setSelectedNodeId.bind(null, node.id)}
										onMouseEnter={setHoveredNodeId.bind(null, node.id)}
										onMouseLeave={setHoveredNodeId.bind(null, null)}
									>
										<div
											{...stylex.props(
												styles.statusDot,
												statusDotStyle(node.status)
											)}
										/>
										<span {...stylex.props(styles.nodeLabel)}>
											{node.label}
										</span>
									</button>
								);
							})}
						</div>
					)}
				</div>
			</div>
			<div {...stylex.props(styles.inspector)}>
				<div {...stylex.props(styles.inspectorHeader)}>
					<p {...stylex.props(styles.inspectorTitle)}>File Graph</p>
					<p {...stylex.props(styles.inspectorSubtitle)}>
						{project?.name ?? cwdLabel(activeCwd)}
					</p>
				</div>
				<div {...stylex.props(styles.inspectorBody)}>
					{selectedNode ? (
						<>
							<div>
								<p {...stylex.props(styles.sectionLabel)}>Selected File</p>
								<p {...stylex.props(styles.selectedFileName)}>
									{selectedNode.label}
								</p>
								<p {...stylex.props(styles.selectedPath)}>
									{selectedNode.path}
								</p>
							</div>
							<div>
								<p {...stylex.props(styles.sectionLabel)}>Status</p>
								<p {...stylex.props(styles.statusText)}>
									{selectedNode.status}
								</p>
							</div>
							<div>
								<p {...stylex.props(styles.relatedLabel)}>Related Files</p>
								<div {...stylex.props(styles.relatedList)}>
									{selectedConnections.length > 0 ? (
										selectedConnections.map((node) => (
											<button
												type="button"
												key={node.id}
												onClick={setSelectedNodeId.bind(null, node.id)}
												{...stylex.props(styles.relatedButton)}
											>
												<div
													{...stylex.props(
														styles.statusDot,
														statusDotStyle(node.status)
													)}
												/>
												<div {...stylex.props(styles.relatedText)}>
													<p {...stylex.props(styles.relatedName)}>
														{node.label}
													</p>
													<p {...stylex.props(styles.relatedPath)}>
														{node.path}
													</p>
												</div>
											</button>
										))
									) : (
										<p {...stylex.props(styles.centerText)}>
											No related files detected yet.
										</p>
									)}
								</div>
							</div>
						</>
					) : (
						<p {...stylex.props(styles.centerText)}>
							Select a file node to inspect its relationships.
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

const styles = stylex.create({
	noProject: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		padding: controlSize._6,
	},
	noProjectText: {
		color: color.textMain,
		fontSize: font.size_5,
	},
	root: {
		display: "flex",
		height: "100%",
		overflow: "hidden",
	},
	canvasPane: {
		position: "relative",
		minWidth: 0,
		flex: 1,
		overflow: "hidden",
		backgroundColor: color.background,
	},
	gridBackdrop: {
		position: "absolute",
		inset: 0,
		backgroundImage:
			"radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
		backgroundSize: "20px 20px",
	},
	canvasControls: {
		position: "absolute",
		zIndex: 10,
		left: controlSize._4,
		top: controlSize._4,
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
	},
	dropdownButton: {
		height: controlSize._7,
		borderRadius: radius.lg,
		borderColor: color.border,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		paddingInline: controlSize._2_5,
	},
	dropdownLabel: {
		maxWidth: "140px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: font.size_2,
	},
	branchPill: {
		display: "flex",
		height: controlSize._7,
		alignItems: "center",
		gap: controlSize._1_5,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundColor: color.backgroundRaised,
		color: color.textSoft,
		fontSize: font.size_2,
		paddingInline: controlSize._2_5,
	},
	monoText: {
		fontFamily: font.familyMono,
	},
	canvasScroll: {
		position: "absolute",
		inset: 0,
		overflow: "auto",
		paddingBlock: controlSize._16,
		paddingInline: controlSize._12,
	},
	centerState: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
	},
	centerText: {
		color: color.textMuted,
		fontSize: font.size_2,
	},
	graphStage: {
		position: "relative",
		width: "100%",
		minWidth: "820px",
		maxWidth: "980px",
		height: "640px",
		marginInline: "auto",
	},
	connectionsLayer: {
		position: "absolute",
		inset: 0,
		width: "100%",
		height: "100%",
	},
	nodeButton: {
		position: "absolute",
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		borderWidth: 1,
		borderStyle: "solid",
		borderRadius: radius.lg,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionProperty: "background-color, border-color, box-shadow",
		transitionDuration: motion.durationFast,
	},
	nodeIdle: {
		borderColor: color.border,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
	},
	nodeSelected: {
		boxShadow: shadow.selectedRing,
	},
	nodeAdded: {
		borderColor: color.successBorder,
		backgroundColor: color.successWash,
	},
	nodeModified: {
		borderColor: color.warningBorder,
		backgroundColor: color.warningWash,
	},
	nodeNormal: {
		borderColor: color.border,
		backgroundColor: color.backgroundRaised,
	},
	statusDot: {
		width: controlSize._2,
		height: controlSize._2,
		borderRadius: radius.pill,
	},
	dotAdded: {
		backgroundColor: color.success,
	},
	dotModified: {
		backgroundColor: color.warning,
	},
	dotNormal: {
		backgroundColor: color.textMuted,
	},
	nodeLabel: {
		whiteSpace: "nowrap",
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
	},
	inspector: {
		width: "20rem",
		flexShrink: 0,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		backgroundColor: color.surfaceTranslucent,
	},
	inspectorHeader: {
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingBlock: controlSize._3,
		paddingInline: controlSize._4,
	},
	inspectorTitle: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
	},
	inspectorSubtitle: {
		color: color.textMuted,
		fontSize: font.size_2,
	},
	inspectorBody: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._4,
		overflowY: "auto",
		padding: controlSize._4,
	},
	sectionLabel: {
		marginBottom: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_2,
		letterSpacing: "0.12em",
		textTransform: "uppercase",
	},
	selectedFileName: {
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
	},
	selectedPath: {
		marginTop: controlSize._1,
		overflowWrap: "anywhere",
		color: color.textMuted,
		fontSize: font.size_2,
	},
	statusText: {
		color: color.textSoft,
		fontSize: font.size_2,
		textTransform: "capitalize",
	},
	relatedLabel: {
		marginBottom: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_2,
		letterSpacing: "0.12em",
		textTransform: "uppercase",
	},
	relatedList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
	},
	relatedButton: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		gap: controlSize._2,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2_5,
		textAlign: "left",
		transitionProperty: "background-color",
		transitionDuration: motion.durationFast,
	},
	relatedText: {
		minWidth: 0,
	},
	relatedName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
	},
	relatedPath: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
	},
});
