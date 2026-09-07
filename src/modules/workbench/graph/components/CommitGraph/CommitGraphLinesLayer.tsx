import { memo } from "octane";
import type { CSSProperties } from "react";
import type { GraphLines } from "../../../../../../build/presentation/contracts/GraphLines.ts";
export const CommitGraphLinesLayer = memo(function CommitGraphLinesLayer({
	width,
	height,
	className,
	style,
	lines,
	lineWidth,
}: {
	width: number;
	height: number;
	className?: string;
	style?: CSSProperties;
	lines: GraphLines;
	lineWidth: number;
}) {
	return (
		<svg
			strokeWidth={lineWidth}
			strokeLinecap="round"
			aria-hidden="true"
			overflow="hidden"
			className={className}
			width={width}
			height={height}
			style={style}
		>
			{lines.rails.map((segment) => (
				<line
					key={segment.key}
					data-graph-rail="true"
					data-graph-row={segment.row}
					data-graph-column={segment.column}
					x1={segment.x}
					y1={segment.top}
					x2={segment.x}
					y2={segment.bottom}
					stroke={segment.color}
					strokeOpacity={0.98}
				/>
			))}
			{lines.transitions.map((curve) => (
				<path
					key={curve.key}
					data-graph-transition="true"
					d={curve.path}
					stroke={curve.color}
					strokeOpacity={0.96}
					strokeLinejoin="round"
					fill="none"
				/>
			))}
			{lines.convergences.map((curve) => (
				<path
					key={curve.key}
					data-graph-convergence="true"
					d={curve.path}
					stroke={curve.color}
					strokeOpacity={0.98}
					strokeLinejoin="round"
					fill="none"
				/>
			))}
			{lines.truncated.map((segment) => (
				<g key={segment.key}>
					<line
						data-graph-truncated="true"
						x1={segment.x}
						y1={segment.top}
						x2={segment.x}
						y2={segment.bottom}
						stroke={segment.color}
						strokeDasharray="2 3"
					/>
					<circle
						cx={segment.x}
						cy={segment.bottom - 1}
						r={lineWidth}
						fill={segment.color}
					/>
				</g>
			))}
		</svg>
	);
});
