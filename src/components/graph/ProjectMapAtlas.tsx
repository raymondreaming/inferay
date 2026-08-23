import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import type { GitProjectStatus } from "../../features/git/types.ts";
import { formatBytes } from "../../lib/format.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../tokens.stylex.ts";
import {
	type AtlasConnection,
	type AtlasDistrict,
	type AtlasNodeStatus,
	atlasFileLabel,
	buildDistrictFileNodes,
	buildProjectAtlas,
	type ProjectMapData,
	type ProjectMapFile,
} from "./project-map-model.ts";

interface ViewTransform {
	readonly x: number;
	readonly y: number;
	readonly scale: number;
}

interface SceneNode {
	readonly id: string;
	readonly code: string;
	readonly label: string;
	readonly displayLabel: string;
	readonly sublabel: string;
	readonly x: number;
	readonly y: number;
	readonly height: number;
	readonly status: AtlasNodeStatus;
	readonly connections: readonly AtlasConnection[];
}

interface CubeGeometry {
	readonly top: string;
	readonly left: string;
	readonly right: string;
	readonly apex: { readonly x: number; readonly y: number };
}

const INITIAL_VIEW: ViewTransform = { x: 0, y: 0, scale: 1 };
const numberFormatter = new Intl.NumberFormat();

function compactNumber(value: number) {
	if (value < 1_000) return String(value);
	if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
	return `${Math.round(value / 1_000)}k`;
}

function truncate(value: string, max: number) {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function truncateFileLabel(value: string, max: number) {
	if (value.length <= max) return value;
	const suffix = "/index";
	if (!value.endsWith(suffix)) return truncate(value, max);
	return `${value.slice(0, max - suffix.length - 1)}…${suffix}`;
}

function cubeGeometry(node: SceneNode, detail: boolean): CubeGeometry {
	const halfWidth = detail ? 45 : 62;
	const halfDepth = detail ? 22 : 30;
	const centerY = node.y - node.height;
	const north = `${node.x},${centerY - halfDepth}`;
	const east = `${node.x + halfWidth},${centerY}`;
	const south = `${node.x},${centerY + halfDepth}`;
	const west = `${node.x - halfWidth},${centerY}`;
	const southDown = `${node.x},${centerY + halfDepth + node.height}`;
	const westDown = `${node.x - halfWidth},${centerY + node.height}`;
	const eastDown = `${node.x + halfWidth},${centerY + node.height}`;
	return {
		top: `${north} ${east} ${south} ${west}`,
		left: `${west} ${south} ${southDown} ${westDown}`,
		right: `${south} ${east} ${eastDown} ${southDown}`,
		apex: { x: node.x, y: centerY - halfDepth },
	};
}

function faceFill(status: AtlasNodeStatus, side: "top" | "left" | "right") {
	const weight = side === "top" ? 18 : side === "left" ? 8 : 12;
	if (status === "added") {
		return `color-mix(in srgb, var(--color-inferay-success) ${weight}%, var(--color-inferay-dark-gray))`;
	}
	if (status === "modified") {
		return `color-mix(in srgb, var(--color-inferay-warning) ${weight}%, var(--color-inferay-dark-gray))`;
	}
	if (side === "top") {
		return "color-mix(in srgb, var(--color-inferay-gray) 86%, var(--color-inferay-dark-gray))";
	}
	if (side === "left") {
		return "color-mix(in srgb, var(--color-inferay-dark-gray) 78%, var(--color-inferay-black))";
	}
	return "color-mix(in srgb, var(--color-inferay-gray) 54%, var(--color-inferay-black))";
}

function connectionPath(source: CubeGeometry, target: CubeGeometry) {
	const midY = (source.apex.y + target.apex.y) / 2;
	return `M ${source.apex.x} ${source.apex.y} C ${source.apex.x} ${midY}, ${target.apex.x} ${midY}, ${target.apex.x} ${target.apex.y}`;
}

function statusStyle(status: AtlasNodeStatus) {
	if (status === "added") return styles.statusAdded;
	if (status === "modified") return styles.statusModified;
	return styles.statusNormal;
}

function sceneNodesForDistrict(
	district: AtlasDistrict,
	data: ProjectMapData,
	project: GitProjectStatus | null,
) {
	return buildDistrictFileNodes(district, data.edges, project).map(
		(node): SceneNode => ({
			id: node.id,
			code: node.code,
			label: node.file.name,
			displayLabel: atlasFileLabel(node.file),
			sublabel: `${node.code} · ${compactNumber(node.file.lines)}L`,
			x: node.x,
			y: node.y,
			height: node.height,
			status: node.status,
			connections: node.connections,
		}),
	);
}

function overviewSceneNodes(districts: readonly AtlasDistrict[]) {
	return districts.map(
		(district): SceneNode => ({
			id: district.id,
			code: district.code,
			label: district.label,
			displayLabel: district.code,
			sublabel: `${district.fileCount} files · ${compactNumber(district.lines)} lines`,
			x: district.x,
			y: district.y,
			height: district.height,
			status: district.status,
			connections: district.connections,
		}),
	);
}

function AtlasStats({
	data,
	project,
}: {
	data: ProjectMapData;
	project: GitProjectStatus | null;
}) {
	const changed = project?.files.length ?? 0;
	const stats = [
		["Repository", data.name],
		["Source", `${numberFormatter.format(data.totalFiles)} files`],
		["Lines", numberFormatter.format(data.totalLines)],
		["Symbols", numberFormatter.format(data.symbolCount)],
		["Links", numberFormatter.format(data.edges.length)],
		["Working tree", changed === 0 ? "Clean" : `${changed} changed`],
	];
	return (
		<header {...stylex.props(styles.statsBar)}>
			{stats.map(([label, value], index) => (
				<div
					key={label}
					{...stylex.props(styles.stat, index === 0 && styles.statFirst)}
				>
					<span {...stylex.props(styles.statLabel)}>{label}</span>
					<span {...stylex.props(styles.statValue)}>{value}</span>
				</div>
			))}
		</header>
	);
}

function AtlasNavigator({
	districts,
	selectedDistrictId,
	hoveredId,
	onEnter,
	onHover,
}: {
	districts: readonly AtlasDistrict[];
	selectedDistrictId: string | null;
	hoveredId: string | null;
	onEnter: (id: string) => void;
	onHover: (id: string | null) => void;
}) {
	const groups = useMemo(() => {
		const result = new Map<string, AtlasDistrict[]>();
		for (const district of districts) {
			const group =
				district.id === "root" ? "Project" : district.id.split("/")[0]!;
			const items = result.get(group) ?? [];
			items.push(district);
			result.set(group, items);
		}
		return [...result];
	}, [districts]);
	return (
		<nav aria-label="Project districts" {...stylex.props(styles.navigator)}>
			<div {...stylex.props(styles.navigatorIntro)}>
				<p {...stylex.props(styles.eyebrow)}>Project atlas</p>
				<p {...stylex.props(styles.navigatorHint)}>
					Select a district to go inside.
				</p>
			</div>
			<div {...stylex.props(styles.navigatorScroll)}>
				{groups.map(([group, items]) => (
					<section key={group} {...stylex.props(styles.navGroup)}>
						<p {...stylex.props(styles.navGroupLabel)}>{group}</p>
						{items.map((district) => {
							const active = district.id === selectedDistrictId;
							const hovered = district.id === hoveredId;
							return (
								<button
									type="button"
									key={district.id}
									onClick={() => onEnter(district.id)}
									onMouseEnter={() => onHover(district.id)}
									onMouseLeave={() => onHover(null)}
									{...stylex.props(
										styles.navItem,
										(active || hovered) && styles.navItemActive,
									)}
								>
									<span {...stylex.props(styles.navCode)}>{district.code}</span>
									<span {...stylex.props(styles.navText)}>
										<span {...stylex.props(styles.navName)}>
											{district.label}
										</span>
										<span {...stylex.props(styles.navMeta)}>
											{district.fileCount} · {compactNumber(district.lines)}L
										</span>
									</span>
									<span
										{...stylex.props(
											styles.statusDot,
											statusStyle(district.status),
										)}
									/>
								</button>
							);
						})}
					</section>
				))}
			</div>
		</nav>
	);
}

function MetricCard({ label, value }: { label: string; value: string }) {
	return (
		<div {...stylex.props(styles.metricCard)}>
			<span {...stylex.props(styles.metricLabel)}>{label}</span>
			<span {...stylex.props(styles.metricValue)}>{value}</span>
		</div>
	);
}

function FileInspector({
	file,
	district,
	data,
	project,
	onBack,
	onSelectFile,
}: {
	file: ProjectMapFile;
	district: AtlasDistrict;
	data: ProjectMapData;
	project: GitProjectStatus | null;
	onBack: () => void;
	onSelectFile: (path: string) => void;
}) {
	const outgoing = data.edges
		.filter((edge) => edge.source === file.path)
		.map((edge) =>
			data.files.find((candidate) => candidate.path === edge.target),
		)
		.filter((candidate): candidate is ProjectMapFile => !!candidate);
	const incoming = data.edges
		.filter((edge) => edge.target === file.path)
		.map((edge) =>
			data.files.find((candidate) => candidate.path === edge.source),
		)
		.filter((candidate): candidate is ProjectMapFile => !!candidate);
	const changed = project?.files.find((entry) => entry.path === file.path);
	return (
		<div {...stylex.props(styles.inspectorBody)}>
			<button type="button" onClick={onBack} {...stylex.props(styles.backLink)}>
				← {district.code}
			</button>
			<div>
				<div {...stylex.props(styles.chipRow)}>
					<span {...stylex.props(styles.kindChip)}>
						{file.extension || "file"}
					</span>
					<span {...stylex.props(styles.languageChip)}>{file.language}</span>
				</div>
				<h2 {...stylex.props(styles.inspectorTitle)}>{file.name}</h2>
				<p {...stylex.props(styles.inspectorPath)}>{file.path}</p>
			</div>
			<div {...stylex.props(styles.metricGrid)}>
				<MetricCard label="Lines" value={numberFormatter.format(file.lines)} />
				<MetricCard label="Size" value={formatBytes(file.bytes)} />
				<MetricCard label="Exports" value={String(file.symbols.length)} />
				<MetricCard label="Git" value={changed ? changed.status : "—"} />
			</div>
			<section {...stylex.props(styles.inspectorSection)}>
				<p {...stylex.props(styles.sectionTitle)}>Structure</p>
				{file.symbols.length > 0 ? (
					<div {...stylex.props(styles.structureList)}>
						{file.symbols.map((symbol) => (
							<div
								key={`${symbol.kind}:${symbol.name}:${symbol.line}`}
								{...stylex.props(styles.structureRow)}
							>
								<span {...stylex.props(styles.structureKind)}>
									{symbol.kind.slice(0, 4)}
								</span>
								<span {...stylex.props(styles.structureName)}>
									{symbol.name}
								</span>
								<span {...stylex.props(styles.structureLine)}>
									L{symbol.line}
								</span>
							</div>
						))}
					</div>
				) : (
					<p {...stylex.props(styles.mutedCopy)}>
						No named declarations detected.
					</p>
				)}
			</section>
			{outgoing.length > 0 || incoming.length > 0 ? (
				<section {...stylex.props(styles.inspectorSection)}>
					<p {...stylex.props(styles.sectionTitle)}>Verified links</p>
					{outgoing.map((target) => (
						<button
							key={`out:${target.path}`}
							type="button"
							onClick={() => onSelectFile(target.path)}
							{...stylex.props(styles.fileLink)}
						>
							<span>→</span>
							<span>{target.name}</span>
						</button>
					))}
					{incoming.slice(0, 8).map((source) => (
						<button
							key={`in:${source.path}`}
							type="button"
							onClick={() => onSelectFile(source.path)}
							{...stylex.props(styles.fileLink)}
						>
							<span>←</span>
							<span>{source.name}</span>
						</button>
					))}
				</section>
			) : null}
		</div>
	);
}

function AtlasInspector({
	data,
	project,
	district,
	file,
	onBackToSystem,
	onBackToDistrict,
	onSelectFile,
}: {
	data: ProjectMapData;
	project: GitProjectStatus | null;
	district: AtlasDistrict | null;
	file: ProjectMapFile | null;
	onBackToSystem: () => void;
	onBackToDistrict: () => void;
	onSelectFile: (path: string) => void;
}) {
	if (district && file) {
		return (
			<FileInspector
				file={file}
				district={district}
				data={data}
				project={project}
				onBack={onBackToDistrict}
				onSelectFile={onSelectFile}
			/>
		);
	}
	if (district) {
		const changed = district.files.filter((candidate) =>
			project?.files.some((entry) => entry.path === candidate.path),
		).length;
		return (
			<div {...stylex.props(styles.inspectorBody)}>
				<button
					type="button"
					onClick={onBackToSystem}
					{...stylex.props(styles.backLink)}
				>
					← System map
				</button>
				<div>
					<p {...stylex.props(styles.eyebrow)}>District · {district.code}</p>
					<h2 {...stylex.props(styles.inspectorTitle)}>{district.label}</h2>
					<p {...stylex.props(styles.inspectorLead)}>
						A live view of the source files inside this module. Lines show
						imports resolved to other local files in the same scene.
					</p>
				</div>
				<div {...stylex.props(styles.metricGrid)}>
					<MetricCard label="Files" value={String(district.fileCount)} />
					<MetricCard label="Lines" value={compactNumber(district.lines)} />
					<MetricCard label="Symbols" value={String(district.symbolCount)} />
					<MetricCard label="Changed" value={String(changed)} />
				</div>
				<section {...stylex.props(styles.inspectorSection)}>
					<p {...stylex.props(styles.sectionTitle)}>Languages</p>
					{district.languages.map(([language, count], index) => (
						<div key={language} {...stylex.props(styles.languageRow)}>
							<span>{language}</span>
							<span {...stylex.props(styles.languageTrack)}>
								<span
									{...stylex.props(styles.languageFill)}
									style={{
										width: `${Math.max(8, (count / district.fileCount) * 100)}%`,
										opacity: 1 - Math.min(index, 5) * 0.11,
									}}
								/>
							</span>
							<span>{count}</span>
						</div>
					))}
				</section>
				<section {...stylex.props(styles.inspectorSection)}>
					<p {...stylex.props(styles.sectionTitle)}>Files</p>
					<div {...stylex.props(styles.fileList)}>
						{district.files.slice(0, 18).map((candidate) => (
							<button
								key={candidate.path}
								type="button"
								onClick={() => onSelectFile(candidate.path)}
								{...stylex.props(styles.fileListItem)}
							>
								<span {...stylex.props(styles.fileExtension)}>
									{candidate.extension || "·"}
								</span>
								<span {...stylex.props(styles.fileListName)}>
									{candidate.name}
								</span>
								<span {...stylex.props(styles.fileLines)}>
									{candidate.lines}L
								</span>
							</button>
						))}
					</div>
				</section>
			</div>
		);
	}

	const languages = Object.entries(data.languageCounts).toSorted(
		(a, b) => b[1] - a[1],
	);
	return (
		<div {...stylex.props(styles.inspectorBody)}>
			<div>
				<p {...stylex.props(styles.eyebrow)}>System overview</p>
				<h2 {...stylex.props(styles.inspectorTitle)}>
					Your codebase, as a place
				</h2>
				<p {...stylex.props(styles.inspectorLead)}>
					Each structure is a real source district. Height reflects line count;
					pathways are imports Inferay resolved inside the repository.
				</p>
			</div>
			<div {...stylex.props(styles.callout)}>
				<span {...stylex.props(styles.calloutMark)}>↗</span>
				<div>
					<strong>
						{numberFormatter.format(data.edges.length)} verified{" "}
						{data.edges.length === 1 ? "link" : "links"}
					</strong>
					<p {...stylex.props(styles.calloutCopy)}>
						Filename similarity is never used to draw a path.
					</p>
				</div>
			</div>
			<section {...stylex.props(styles.inspectorSection)}>
				<p {...stylex.props(styles.sectionTitle)}>Language terrain</p>
				{languages.slice(0, 7).map(([language, count], index) => (
					<div key={language} {...stylex.props(styles.languageRow)}>
						<span>{language}</span>
						<span {...stylex.props(styles.languageTrack)}>
							<span
								{...stylex.props(styles.languageFill)}
								style={{
									width: `${Math.max(8, (count / data.totalFiles) * 100)}%`,
									opacity: 1 - Math.min(index, 5) * 0.11,
								}}
							/>
						</span>
						<span>{count}</span>
					</div>
				))}
			</section>
			<section {...stylex.props(styles.inspectorSection)}>
				<p {...stylex.props(styles.sectionTitle)}>Reading the atlas</p>
				<div {...stylex.props(styles.legendRow)}>
					<span {...stylex.props(styles.legendSwatch, styles.legendNormal)} />
					<span>Tracked source</span>
				</div>
				<div {...stylex.props(styles.legendRow)}>
					<span {...stylex.props(styles.legendSwatch, styles.legendModified)} />
					<span>Modified source</span>
				</div>
				<div {...stylex.props(styles.legendRow)}>
					<span {...stylex.props(styles.legendSwatch, styles.legendAdded)} />
					<span>New source</span>
				</div>
			</section>
			{data.truncated ? (
				<p {...stylex.props(styles.truncatedNote)}>
					The scan reached its {numberFormatter.format(data.totalFiles)}-file
					display cap.
				</p>
			) : null}
		</div>
	);
}

function SceneCube({
	node,
	detail,
	selected,
	hovered,
	flowing,
	onClick,
	onHover,
}: {
	node: SceneNode;
	detail: boolean;
	selected: boolean;
	hovered: boolean;
	flowing: boolean;
	onClick: () => void;
	onHover: (hovered: boolean) => void;
}) {
	const geometry = cubeGeometry(node, detail);
	const active = selected || hovered || flowing;
	const stroke = active
		? "var(--color-inferay-accent)"
		: "var(--color-inferay-gray-border-bold)";
	const strokeWidth = active ? 2 : 1;
	return (
		<g
			role="button"
			tabIndex={0}
			aria-label={`${node.label}, ${node.sublabel}`}
			data-atlas-node="true"
			onClick={onClick}
			onMouseEnter={() => onHover(true)}
			onMouseLeave={() => onHover(false)}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onClick();
				}
			}}
			{...stylex.props(
				styles.cube,
				active && styles.cubeActive,
				flowing && styles.cubeFlowing,
			)}
		>
			<polygon
				points={geometry.left}
				fill={faceFill(node.status, "left")}
				stroke={stroke}
				strokeWidth={strokeWidth}
			/>
			<polygon
				points={geometry.right}
				fill={faceFill(node.status, "right")}
				stroke={stroke}
				strokeWidth={strokeWidth}
			/>
			<polygon
				points={geometry.top}
				fill={faceFill(node.status, "top")}
				stroke={stroke}
				strokeWidth={strokeWidth}
			/>
			<polygon
				points={geometry.top}
				fill="url(#atlas-hatch)"
				opacity={active ? 0.28 : 0.14}
			/>
			{detail ? (
				<>
					<text
						x={node.x}
						y={node.y - node.height - 4}
						textAnchor="middle"
						{...stylex.props(styles.cubeFileName)}
					>
						{truncateFileLabel(node.displayLabel, 16)}
					</text>
					<text
						x={node.x}
						y={node.y - node.height + 8}
						textAnchor="middle"
						{...stylex.props(styles.cubeFileMeta)}
					>
						{node.sublabel}
					</text>
				</>
			) : (
				<>
					<text
						x={node.x}
						y={node.y - node.height - 2}
						textAnchor="middle"
						{...stylex.props(styles.cubeCode)}
					>
						{node.code}
					</text>
					<text
						x={node.x}
						y={node.y - node.height + 12}
						textAnchor="middle"
						{...stylex.props(styles.cubeSublabel)}
					>
						{truncate(node.label, 17)}
					</text>
				</>
			)}
		</g>
	);
}

function AtlasScene({
	nodes,
	detail,
	selectedId,
	hoveredId,
	flowId,
	view,
	onSelect,
	onHover,
	onViewChange,
}: {
	nodes: readonly SceneNode[];
	detail: boolean;
	selectedId: string | null;
	hoveredId: string | null;
	flowId: string | null;
	view: ViewTransform;
	onSelect: (id: string) => void;
	onHover: (id: string | null) => void;
	onViewChange: (view: ViewTransform) => void;
}) {
	const dragRef = useRef<{
		pointerId: number;
		clientX: number;
		clientY: number;
		x: number;
		y: number;
	} | null>(null);
	const byId = useMemo(
		() => new Map(nodes.map((node) => [node.id, node])),
		[nodes],
	);
	const geometries = useMemo(
		() => new Map(nodes.map((node) => [node.id, cubeGeometry(node, detail)])),
		[detail, nodes],
	);
	const lines = useMemo(() => {
		const seen = new Set<string>();
		return nodes.flatMap((node) =>
			node.connections.flatMap((connection) => {
				const target = byId.get(connection.target);
				const sourceGeometry = geometries.get(node.id);
				const targetGeometry = geometries.get(connection.target);
				if (!target || !sourceGeometry || !targetGeometry) return [];
				const key = `${node.id}>${target.id}`;
				if (seen.has(key)) return [];
				seen.add(key);
				return [
					{
						key,
						node,
						target,
						count: connection.count,
						path: connectionPath(sourceGeometry, targetGeometry),
					},
				];
			}),
		);
	}, [byId, geometries, nodes]);
	const handlePointerDown = (
		event: PointerEvent & { currentTarget: SVGSVGElement },
	) => {
		if ((event.target as Element).closest("[data-atlas-node]")) return;
		dragRef.current = {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			x: view.x,
			y: view.y,
		};
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const handlePointerMove = (
		event: PointerEvent & { currentTarget: SVGSVGElement },
	) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		onViewChange({
			...view,
			x: drag.x + (event.clientX - drag.clientX) / view.scale,
			y: drag.y + (event.clientY - drag.clientY) / view.scale,
		});
	};
	const stopDrag = () => {
		dragRef.current = null;
	};
	const handleWheel = (
		event: WheelEvent & { currentTarget: SVGSVGElement },
	) => {
		event.preventDefault();
		const factor = event.deltaY < 0 ? 1.1 : 0.9;
		onViewChange({
			...view,
			scale: Math.max(0.55, Math.min(2.2, view.scale * factor)),
		});
	};
	return (
		<svg
			viewBox="0 0 1200 760"
			aria-label={
				detail
					? "Files in the selected project district"
					: "Project architecture overview"
			}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={stopDrag}
			onPointerCancel={stopDrag}
			onWheel={handleWheel}
			{...stylex.props(styles.scene)}
		>
			<defs>
				<pattern
					id="atlas-grid"
					width="56"
					height="32"
					patternUnits="userSpaceOnUse"
					patternTransform="skewY(0)"
				>
					<path
						d="M 28 0 L 56 16 L 28 32 L 0 16 Z"
						fill="none"
						stroke="var(--color-inferay-gray-border)"
						strokeWidth="0.7"
					/>
				</pattern>
				<pattern
					id="atlas-hatch"
					width="7"
					height="7"
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(38)"
				>
					<line
						x1="0"
						y1="0"
						x2="0"
						y2="7"
						stroke="var(--color-inferay-white)"
						strokeWidth="1"
					/>
				</pattern>
				<marker
					id="atlas-arrow"
					markerWidth="7"
					markerHeight="7"
					refX="6"
					refY="3.5"
					orient="auto"
					markerUnits="strokeWidth"
				>
					<path d="M0,0 L7,3.5 L0,7 Z" fill="var(--color-inferay-muted-gray)" />
				</marker>
				<filter id="atlas-glow" x="-80%" y="-80%" width="260%" height="260%">
					<feGaussianBlur stdDeviation="5" result="blur" />
					<feMerge>
						<feMergeNode in="blur" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>
			<g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
				<rect
					x="0"
					y="0"
					width="1200"
					height="760"
					fill="url(#atlas-grid)"
					opacity="0.3"
				/>
				<g>
					{lines.map((line) => {
						const active = [selectedId, hoveredId, flowId].some(
							(id) => id === line.node.id || id === line.target.id,
						);
						return (
							<path
								key={line.key}
								d={line.path}
								fill="none"
								stroke={
									active
										? "var(--color-inferay-accent)"
										: "var(--color-inferay-muted-gray)"
								}
								strokeOpacity={active ? 0.72 : 0.2}
								strokeWidth={
									active ? 1.8 : Math.min(1.4, 0.7 + line.count * 0.12)
								}
								strokeDasharray={active ? undefined : "4 6"}
								markerEnd="url(#atlas-arrow)"
							/>
						);
					})}
				</g>
				{nodes
					.toSorted((a, b) => a.y - b.y)
					.map((node) => (
						<SceneCube
							key={node.id}
							node={node}
							detail={detail}
							selected={selectedId === node.id}
							hovered={hoveredId === node.id}
							flowing={flowId === node.id}
							onClick={() => onSelect(node.id)}
							onHover={(hovered) => onHover(hovered ? node.id : null)}
						/>
					))}
			</g>
		</svg>
	);
}

export function ProjectMapAtlas({
	data,
	project,
}: {
	data: ProjectMapData;
	project: GitProjectStatus | null;
}) {
	const atlas = useMemo(
		() => buildProjectAtlas(data, project),
		[data, project],
	);
	const [districtId, setDistrictId] = useState<string | null>(null);
	const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [view, setView] = useState<ViewTransform>(INITIAL_VIEW);
	const [tracing, setTracing] = useState(false);
	const [flowIndex, setFlowIndex] = useState(0);
	const selectedDistrict =
		atlas.districts.find((district) => district.id === districtId) ?? null;
	const selectedFile =
		selectedDistrict?.files.find((file) => file.path === selectedFilePath) ??
		null;
	const nodes = useMemo(
		() =>
			selectedDistrict
				? sceneNodesForDistrict(selectedDistrict, data, project)
				: overviewSceneNodes(atlas.districts),
		[atlas.districts, data, project, selectedDistrict],
	);
	const selectedNodeId = selectedDistrict ? selectedFilePath : null;
	const activeSceneNode =
		nodes.find((node) => node.id === hoveredId) ??
		nodes.find((node) => node.id === selectedNodeId) ??
		null;
	const flowId =
		!selectedDistrict && (tracing || flowIndex > 0)
			? (atlas.primaryPath[flowIndex % Math.max(1, atlas.primaryPath.length)] ??
				null)
			: null;

	useEffect(() => {
		setDistrictId(null);
		setSelectedFilePath(null);
		setHoveredId(null);
		setView(INITIAL_VIEW);
		setTracing(false);
		setFlowIndex(0);
	}, [data.cwd]);
	useEffect(() => {
		if (!tracing || atlas.primaryPath.length < 2) return;
		const interval = window.setInterval(
			() => setFlowIndex((index) => (index + 1) % atlas.primaryPath.length),
			720,
		);
		return () => window.clearInterval(interval);
	}, [atlas.primaryPath, tracing]);
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (selectedFilePath) setSelectedFilePath(null);
			else if (districtId) setDistrictId(null);
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [districtId, selectedFilePath]);

	const enterDistrict = useCallback((id: string) => {
		setDistrictId(id);
		setSelectedFilePath(null);
		setHoveredId(null);
		setTracing(false);
		setView(INITIAL_VIEW);
	}, []);
	const returnToSystem = useCallback(() => {
		setDistrictId(null);
		setSelectedFilePath(null);
		setHoveredId(null);
		setView(INITIAL_VIEW);
	}, []);
	const selectSceneNode = useCallback(
		(id: string) => {
			if (districtId) setSelectedFilePath(id);
			else enterDistrict(id);
		},
		[districtId, enterDistrict],
	);
	const selectFile = useCallback(
		(path: string) => {
			const ownerDistrict = atlas.districtByFile.get(path);
			if (ownerDistrict && ownerDistrict !== districtId)
				setDistrictId(ownerDistrict);
			setSelectedFilePath(path);
			setTracing(false);
		},
		[atlas.districtByFile, districtId],
	);
	const toggleTrace = useCallback(() => {
		if (districtId) returnToSystem();
		setFlowIndex(0);
		setTracing((value) => !value);
	}, [districtId, returnToSystem]);
	const traceStep = useCallback(() => {
		if (districtId) returnToSystem();
		setTracing(false);
		setFlowIndex(
			(index) => (index + 1) % Math.max(1, atlas.primaryPath.length),
		);
	}, [atlas.primaryPath.length, districtId, returnToSystem]);

	return (
		<div {...stylex.props(styles.atlasRoot)}>
			<AtlasStats data={data} project={project} />
			<div {...stylex.props(styles.atlasBody)}>
				<AtlasNavigator
					districts={atlas.districts}
					selectedDistrictId={districtId}
					hoveredId={hoveredId}
					onEnter={enterDistrict}
					onHover={setHoveredId}
				/>
				<main {...stylex.props(styles.canvas)}>
					<div {...stylex.props(styles.ambientGlow)} />
					<div {...stylex.props(styles.sceneTitle)}>
						<p>
							{selectedDistrict
								? `${selectedDistrict.code} / ${activeSceneNode?.label ?? selectedDistrict.label}`
								: "System map"}
						</p>
						<span>
							{selectedDistrict
								? activeSceneNode
									? `${activeSceneNode.id} · ${activeSceneNode.sublabel}`
									: `${nodes.length} of ${selectedDistrict.fileCount} files shown · select a named block`
								: `${atlas.districts.length} districts · pathways are verified imports`}
						</span>
					</div>
					<div {...stylex.props(styles.canvasToolbar)}>
						{selectedDistrict ? (
							<button
								type="button"
								onClick={returnToSystem}
								{...stylex.props(styles.toolbarButton, styles.toolbarPrimary)}
							>
								← All districts
							</button>
						) : null}
						<button
							type="button"
							onClick={toggleTrace}
							disabled={atlas.primaryPath.length < 2}
							{...stylex.props(
								styles.toolbarButton,
								tracing && styles.toolbarPrimary,
							)}
						>
							{tracing ? "Pause flow" : "Trace flow"}
						</button>
						<button
							type="button"
							onClick={traceStep}
							disabled={atlas.primaryPath.length < 2}
							{...stylex.props(styles.toolbarButton)}
						>
							Step
						</button>
						<button
							type="button"
							aria-label="Reset atlas view"
							onClick={() => setView(INITIAL_VIEW)}
							{...stylex.props(styles.toolbarButton)}
						>
							Reset
						</button>
					</div>
					<div {...stylex.props(styles.zoomControls)}>
						<button
							type="button"
							aria-label="Zoom in"
							onClick={() =>
								setView((current) => ({
									...current,
									scale: Math.min(2.2, current.scale * 1.15),
								}))
							}
							{...stylex.props(styles.zoomButton)}
						>
							+
						</button>
						<span {...stylex.props(styles.zoomLabel)}>
							{Math.round(view.scale * 100)}%
						</span>
						<button
							type="button"
							aria-label="Zoom out"
							onClick={() =>
								setView((current) => ({
									...current,
									scale: Math.max(0.55, current.scale * 0.87),
								}))
							}
							{...stylex.props(styles.zoomButton)}
						>
							−
						</button>
					</div>
					<AtlasScene
						nodes={nodes}
						detail={!!selectedDistrict}
						selectedId={selectedNodeId}
						hoveredId={hoveredId}
						flowId={flowId}
						view={view}
						onSelect={selectSceneNode}
						onHover={setHoveredId}
						onViewChange={setView}
					/>
					<div {...stylex.props(styles.canvasFooter)}>
						<span>Drag to pan</span>
						<span>Scroll to zoom</span>
						<span>Esc to go back</span>
					</div>
				</main>
				<aside {...stylex.props(styles.inspector)}>
					<AtlasInspector
						data={data}
						project={project}
						district={selectedDistrict}
						file={selectedFile}
						onBackToSystem={returnToSystem}
						onBackToDistrict={() => setSelectedFilePath(null)}
						onSelectFile={selectFile}
					/>
				</aside>
			</div>
		</div>
	);
}

const styles = stylex.create({
	atlasRoot: {
		display: "flex",
		height: "100%",
		minHeight: 0,
		flexDirection: "column",
		backgroundColor: color.background,
	},
	statsBar: {
		display: "flex",
		minHeight: "4.25rem",
		flexShrink: 0,
		alignItems: "stretch",
		overflowX: "auto",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.surfaceGlassStrong,
		paddingLeft: "14.5rem",
	},
	stat: {
		display: "flex",
		minWidth: "7.5rem",
		flexDirection: "column",
		justifyContent: "center",
		gap: controlSize._1,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		paddingInline: controlSize._4,
	},
	statFirst: { minWidth: "10.5rem" },
	statLabel: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
		letterSpacing: "0.14em",
		textTransform: "uppercase",
		whiteSpace: "nowrap",
	},
	statValue: {
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		whiteSpace: "nowrap",
	},
	atlasBody: {
		display: "grid",
		minHeight: 0,
		flex: 1,
		gridTemplateColumns: {
			default: "minmax(0, 1fr) 16rem",
			"@media (min-width: 860px)": "11rem minmax(0, 1fr) 16rem",
			"@media (min-width: 1120px)": "13.5rem minmax(0, 1fr) 19rem",
		},
	},
	navigator: {
		display: { default: "none", "@media (min-width: 860px)": "flex" },
		minHeight: 0,
		flexDirection: "column",
		borderRightWidth: 1,
		borderRightStyle: "solid",
		borderRightColor: color.border,
		backgroundColor: color.surfaceGlass,
	},
	navigatorIntro: {
		paddingBlock: controlSize._3,
		paddingInline: controlSize._3,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
	},
	eyebrow: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
		letterSpacing: "0.14em",
		textTransform: "uppercase",
	},
	navigatorHint: {
		marginTop: controlSize._1,
		color: color.textSoft,
		fontSize: font.size_1,
		lineHeight: 1.45,
	},
	navigatorScroll: {
		minHeight: 0,
		overflowY: "auto",
		paddingBlock: controlSize._2,
	},
	navGroup: { paddingBottom: controlSize._2 },
	navGroupLabel: {
		marginBlock: controlSize._2,
		paddingInline: controlSize._3,
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
		letterSpacing: "0.12em",
		textTransform: "uppercase",
	},
	navItem: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		gap: controlSize._2,
		borderWidth: 0,
		borderLeftWidth: 2,
		borderLeftStyle: "solid",
		borderLeftColor: "transparent",
		backgroundColor: "transparent",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
	},
	navItemActive: {
		borderLeftColor: color.accent,
		backgroundColor: color.surfaceSubtle,
	},
	navCode: {
		display: "inline-flex",
		width: controlSize._9,
		height: controlSize._5,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.xs,
		backgroundColor: color.surfaceInset,
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
		fontWeight: font.weight_6,
	},
	navText: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		flexDirection: "column",
		gap: 1,
	},
	navName: {
		overflow: "hidden",
		color: color.textMain,
		fontSize: font.size_2,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	navMeta: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
	},
	statusDot: { width: 5, height: 5, flexShrink: 0, borderRadius: radius.pill },
	statusAdded: { backgroundColor: color.success },
	statusModified: { backgroundColor: color.warning },
	statusNormal: { backgroundColor: color.textMuted },
	canvas: {
		position: "relative",
		minWidth: 0,
		minHeight: 0,
		overflow: "hidden",
		backgroundImage:
			"radial-gradient(ellipse at 50% 38%, color-mix(in srgb, var(--color-inferay-gray) 28%, transparent), transparent 64%)",
	},
	ambientGlow: {
		position: "absolute",
		top: "16%",
		left: "42%",
		width: "35%",
		height: "42%",
		borderRadius: radius.pill,
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-accent) 5%, transparent)",
		filter: "blur(80px)",
		pointerEvents: "none",
	},
	sceneTitle: {
		position: "absolute",
		zIndex: 5,
		top: controlSize._3,
		left: controlSize._4,
		display: "flex",
		flexDirection: "column",
		gap: 2,
		pointerEvents: "none",
		transform: "translateY(2.35rem)",
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	canvasToolbar: {
		position: "absolute",
		zIndex: 8,
		top: controlSize._3,
		right: controlSize._3,
		display: "flex",
		gap: controlSize._1_5,
	},
	toolbarButton: {
		height: controlSize._7,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.md,
		backgroundColor: {
			default: color.surfaceTranslucent,
			":hover": color.surfaceControlHover,
		},
		backdropFilter: "blur(16px)",
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
		letterSpacing: "0.04em",
		paddingInline: controlSize._2_5,
		textTransform: "uppercase",
	},
	toolbarPrimary: {
		borderColor: color.accentBorder,
		backgroundColor: {
			default: color.textMain,
			":hover": color.textSoft,
		},
		color: color.background,
		fontWeight: font.weight_6,
	},
	zoomControls: {
		position: "absolute",
		zIndex: 8,
		right: controlSize._3,
		bottom: controlSize._8,
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.md,
		backgroundColor: color.surfaceTranslucent,
		backdropFilter: "blur(16px)",
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
	},
	zoomButton: {
		width: controlSize._8,
		height: controlSize._7,
		color: color.textMain,
	},
	zoomLabel: { paddingBlock: controlSize._1 },
	scene: {
		display: "block",
		width: "100%",
		height: "100%",
		touchAction: "none",
		cursor: "grab",
	},
	cube: {
		cursor: "pointer",
		transitionProperty: "filter, opacity",
		transitionDuration: motion.durationFast,
		":hover": { filter: "brightness(1.16)" },
		":focus-visible": { outline: "none", filter: "brightness(1.2)" },
	},
	cubeActive: { filter: "brightness(1.14)" },
	cubeFlowing: { filter: "url(#atlas-glow) brightness(1.25)" },
	cubeCode: {
		fill: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		letterSpacing: "0.05em",
		pointerEvents: "none",
	},
	cubeFileName: {
		fill: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		pointerEvents: "none",
	},
	cubeFileMeta: {
		fill: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0,
		letterSpacing: "0.04em",
		pointerEvents: "none",
	},
	cubeSublabel: {
		fill: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_0,
		pointerEvents: "none",
	},
	canvasFooter: {
		position: "absolute",
		bottom: controlSize._2,
		left: "50%",
		display: "flex",
		gap: controlSize._4,
		transform: "translateX(-50%)",
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0,
		letterSpacing: "0.08em",
		textTransform: "uppercase",
		whiteSpace: "nowrap",
	},
	inspector: {
		display: "block",
		minHeight: 0,
		overflow: "hidden",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		backgroundColor: color.surfaceGlass,
	},
	inspectorBody: {
		display: "flex",
		height: "100%",
		flexDirection: "column",
		gap: controlSize._4,
		overflowY: "auto",
		padding: controlSize._4,
	},
	backLink: {
		alignSelf: "flex-start",
		borderWidth: 0,
		backgroundColor: "transparent",
		color: { default: color.textMuted, ":hover": color.textMain },
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
		letterSpacing: "0.08em",
		textTransform: "uppercase",
	},
	inspectorTitle: {
		marginTop: controlSize._2,
		color: color.textMain,
		fontSize: "1.2rem",
		fontWeight: font.weight_6,
		letterSpacing: "-0.025em",
		lineHeight: 1.18,
	},
	inspectorLead: {
		marginTop: controlSize._2,
		color: color.textSoft,
		fontSize: font.size_2,
		lineHeight: 1.6,
	},
	inspectorPath: {
		marginTop: controlSize._2,
		overflowWrap: "anywhere",
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		lineHeight: 1.5,
	},
	chipRow: { display: "flex", gap: controlSize._1_5 },
	kindChip: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.accentBorder,
		borderRadius: radius.xs,
		backgroundColor: color.accent,
		color: color.accentForeground,
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
		fontWeight: font.weight_6,
		paddingBlock: 2,
		paddingInline: controlSize._1_5,
		textTransform: "uppercase",
	},
	languageChip: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.xs,
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
		paddingBlock: 2,
		paddingInline: controlSize._1_5,
	},
	metricGrid: {
		display: "grid",
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
		gap: controlSize._2,
	},
	metricCard: {
		display: "flex",
		minWidth: 0,
		flexDirection: "column",
		gap: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.surfaceInset,
		padding: controlSize._2_5,
	},
	metricLabel: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0,
		letterSpacing: "0.1em",
		textTransform: "uppercase",
	},
	metricValue: {
		overflow: "hidden",
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	inspectorSection: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		paddingTop: controlSize._3,
	},
	sectionTitle: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
		letterSpacing: "0.14em",
		textTransform: "uppercase",
	},
	structureList: { display: "flex", flexDirection: "column" },
	structureRow: {
		display: "grid",
		gridTemplateColumns: "2.75rem minmax(0, 1fr) auto",
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.borderSubtle,
		paddingBlock: controlSize._2,
	},
	structureKind: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0,
		textTransform: "uppercase",
	},
	structureName: {
		overflow: "hidden",
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	structureLine: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0,
	},
	mutedCopy: { color: color.textMuted, fontSize: font.size_2 },
	fileLink: {
		display: "grid",
		width: "100%",
		gridTemplateColumns: "1rem minmax(0, 1fr)",
		gap: controlSize._2,
		borderWidth: 0,
		backgroundColor: "transparent",
		color: { default: color.textSoft, ":hover": color.textMain },
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		textAlign: "left",
	},
	languageRow: {
		display: "grid",
		gridTemplateColumns: "4.75rem minmax(0, 1fr) 1.5rem",
		alignItems: "center",
		gap: controlSize._2,
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
	},
	languageTrack: {
		height: 3,
		overflow: "hidden",
		borderRadius: radius.pill,
		backgroundColor: color.surfaceControl,
	},
	languageFill: {
		display: "block",
		height: "100%",
		borderRadius: radius.pill,
		backgroundColor: color.accent,
	},
	fileList: { display: "flex", flexDirection: "column" },
	fileListItem: {
		display: "grid",
		width: "100%",
		gridTemplateColumns: "2.25rem minmax(0, 1fr) auto",
		alignItems: "center",
		gap: controlSize._2,
		borderWidth: 0,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.borderSubtle,
		backgroundColor: { default: "transparent", ":hover": color.surfaceSubtle },
		paddingBlock: controlSize._2,
		color: color.textSoft,
		textAlign: "left",
	},
	fileExtension: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0,
		textTransform: "uppercase",
	},
	fileListName: {
		overflow: "hidden",
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	fileLines: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_0,
	},
	callout: {
		display: "flex",
		gap: controlSize._3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.accentBorder,
		borderRadius: radius.md,
		backgroundColor: color.surfaceInset,
		padding: controlSize._3,
		color: color.textMain,
		fontSize: font.size_2,
	},
	calloutCopy: {
		marginTop: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1.45,
	},
	calloutMark: {
		color: color.accent,
		fontFamily: font.familyMono,
		fontSize: font.size_5,
	},
	legendRow: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		color: color.textSoft,
		fontSize: font.size_2,
	},
	legendSwatch: {
		width: controlSize._5,
		height: controlSize._3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		transform: "skewY(-22deg)",
	},
	legendNormal: { backgroundColor: color.backgroundSubtle },
	legendModified: {
		backgroundColor: color.warningWash,
		borderColor: color.warningBorder,
	},
	legendAdded: {
		backgroundColor: color.successWash,
		borderColor: color.successBorder,
	},
	truncatedNote: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.warningBorder,
		borderRadius: radius.md,
		backgroundColor: color.warningWash,
		color: color.textSoft,
		fontSize: font.size_1,
		lineHeight: 1.5,
		padding: controlSize._3,
	},
});
