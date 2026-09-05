import { memo } from "octane";
import type { CSSProperties } from "react";

export const CommitGraphLinesLayer = memo(function CommitGraphLinesLayer({
	width,
	height,
	className,
	style,
	railSegments,
	transitions,
	convergences,
	truncatedSegments,
	colX,
	rowTop,
	rowBottom,
	buildConnection,
	buildConvergence,
	lineWidth,
}: {
	width: number;
	height: number;
	className?: string;
	style?: CSSProperties;
	railSegments: Array<{
		key: string;
		row: number;
		column: number;
		color: string;
		startsAtNode: boolean;
		endsAtNode: boolean;
	}>;
	transitions: Array<{
		row: number;
		fromCol: number;
		toCol: number;
		color: string;
	}>;
	convergences: Array<{
		row: number;
		fromCol: number;
		toCol: number;
		color: string;
	}>;
	truncatedSegments: Array<{
		key: string;
		row: number;
		column: number;
		color: string;
	}>;
	colX: (column: number) => number;
	rowTop: (row: number) => number;
	rowBottom: (row: number) => number;
	buildConnection: (transition: {
		row: number;
		fromCol: number;
		toCol: number;
		color: string;
	}) => string;
	buildConvergence: (transition: {
		row: number;
		fromCol: number;
		toCol: number;
		color: string;
	}) => string;
	lineWidth: number;
}) {
	return (
		<svg
			aria-hidden="true"
			overflow="hidden"
			className={className}
			width={width}
			height={height}
			style={style}
		>
			{railSegments.map((segment) => {
				const x = colX(segment.column);
				const top = rowTop(segment.row);
				const bottom = rowBottom(segment.row);
				const center = (top + bottom) / 2;
				return (
					<line
						key={segment.key}
						data-graph-rail="true"
						data-graph-row={segment.row}
						data-graph-column={segment.column}
						x1={x}
						y1={segment.startsAtNode ? center : top}
						x2={x}
						y2={segment.endsAtNode ? center : bottom}
						stroke={segment.color}
						strokeWidth={lineWidth}
						strokeOpacity={0.98}
						strokeLinecap="round"
					/>
				);
			})}
			{transitions.map((transition) => (
				<g
					key={`${transition.row}:${transition.fromCol}:${transition.toCol}:${transition.color}`}
				>
					<path
						data-graph-transition="true"
						d={buildConnection(transition)}
						stroke={transition.color}
						strokeWidth={lineWidth}
						strokeOpacity={0.96}
						strokeLinecap="round"
						strokeLinejoin="round"
						fill="none"
					/>
				</g>
			))}
			{convergences.map((transition) => (
				<g
					key={`convergence:${transition.row}:${transition.fromCol}:${transition.toCol}:${transition.color}`}
				>
					<path
						data-graph-convergence="true"
						d={buildConvergence(transition)}
						stroke={transition.color}
						strokeWidth={lineWidth}
						strokeOpacity={0.98}
						strokeLinecap="round"
						strokeLinejoin="round"
						fill="none"
					/>
				</g>
			))}
			{truncatedSegments.map((segment) => {
				const x = colX(segment.column);
				return (
					<g key={segment.key}>
						<line
							data-graph-truncated="true"
							x1={x}
							y1={rowTop(segment.row) + 8}
							x2={x}
							y2={rowBottom(segment.row)}
							stroke={segment.color}
							strokeWidth={lineWidth}
							strokeDasharray="2 3"
							strokeLinecap="round"
						/>
						<circle
							cx={x}
							cy={rowBottom(segment.row) - 1}
							r={lineWidth}
							fill={segment.color}
						/>
					</g>
				);
			})}
		</svg>
	);
});

export type { IconProps } from "./shared.tsx";
export {
	IconAgent,
	IconAlertTriangle,
	IconAnthropic,
	IconArrowDown,
	IconArrowLeft,
	IconArrowUp,
	IconCheck,
	IconChevronDown,
	IconChevronRight,
	IconClock,
	IconCloud,
	IconCode,
	IconCollapse,
	IconComputer,
	IconCopy,
	IconExpand,
	IconExternalLink,
	IconEye,
	IconFilePlus,
	IconFolder,
	IconFolderFill,
	IconFolderOpen,
	IconGitBranch,
	IconGitCommit,
	IconGlobe,
	IconHelpCircle,
	IconLayoutGrid,
	IconLayoutRows,
	IconLoader,
	IconMessageCircle,
	IconMic,
	IconMinus,
	IconOpenAI,
	IconPanelLeft,
	IconPanelRight,
	IconPencil,
	IconPlus,
	IconRefreshCw,
	IconRobot,
	IconSearch,
	IconSend,
	IconSettings,
	IconSlash,
	IconSparkles,
	IconStop,
	IconTag,
	IconTarget,
	IconTrash,
	IconUser,
	IconWorkflow,
	IconWrench,
	IconX,
} from "./shared.tsx";
