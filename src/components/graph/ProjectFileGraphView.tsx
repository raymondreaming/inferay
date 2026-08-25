import * as stylex from "@octanejs/stylex";
import { useCallback, useMemo } from "octane";
import { iconSize } from "../../design-system.ts";
import type { GitProjectStatus } from "../../features/git/types.ts";
import { useQueryResource } from "../../hooks/useQueryResource.tsx";
import {
	breakpoint,
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
} from "../../tokens.stylex.ts";
import { DropdownButton } from "../ui/DropdownButton.tsx";
import { IconFolder, IconGitBranch } from "../ui/Icons.tsx";
import { ProjectMapAtlas } from "./ProjectMapAtlas.tsx";
import type { ProjectMapData } from "./project-map-model.ts";

function cwdLabel(cwd: string) {
	const parts = cwd.split("/");
	return parts[parts.length - 1] || cwd;
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
	const fetchMap = useCallback(async () => {
		if (!activeCwd) return null;
		const response = await fetch(
			`/api/files/map?cwd=${encodeURIComponent(activeCwd)}`,
		);
		if (!response.ok) throw new Error("Could not build the project atlas");
		return (await response.json()) as ProjectMapData;
	}, [activeCwd]);
	const { data, loading, error, refresh } =
		useQueryResource<ProjectMapData | null>(fetchMap, null, {
			queryKey: ["project-map", activeCwd ?? ""],
		});
	const cwdOptions = useMemo(
		() =>
			cwds.map((cwd) => ({
				id: cwd,
				label: cwdLabel(cwd),
				detail: cwd,
				icon: <IconFolder size={iconSize.md} />,
			})),
		[cwds],
	);

	if (!activeCwd) {
		return (
			<div {...stylex.props(styles.centerState)}>
				<p {...stylex.props(styles.centerText)}>
					Open a project directory to build its atlas.
				</p>
			</div>
		);
	}

	const visibleData = data?.cwd === activeCwd ? data : null;
	return (
		<div {...stylex.props(styles.root)}>
			<div {...stylex.props(styles.projectPicker)}>
				<DropdownButton
					value={activeCwd}
					options={cwdOptions}
					onChange={onSelectCwd}
					minWidth={200}
					buttonClassName={stylex.props(styles.dropdownButton).className}
					labelClassName={stylex.props(styles.dropdownLabel).className}
				/>
				{project ? (
					<div {...stylex.props(styles.branchPill)}>
						<IconGitBranch size={iconSize.compact} />
						<span>{project.branch}</span>
					</div>
				) : null}
			</div>
			{loading && !visibleData ? (
				<div {...stylex.props(styles.centerState)}>
					<div {...stylex.props(styles.loadingMark)} aria-hidden="true">
						<span {...stylex.props(styles.loadingBar, styles.loadingBarOne)} />
						<span {...stylex.props(styles.loadingBar, styles.loadingBarTwo)} />
						<span
							{...stylex.props(styles.loadingBar, styles.loadingBarThree)}
						/>
					</div>
					<p {...stylex.props(styles.centerText)}>Surveying the codebase…</p>
				</div>
			) : error ? (
				<div {...stylex.props(styles.centerState)}>
					<p {...stylex.props(styles.errorTitle)}>
						The atlas could not be built.
					</p>
					<p {...stylex.props(styles.centerText)}>{error}</p>
					<button
						type="button"
						onClick={refresh}
						{...stylex.props(styles.retryButton)}
					>
						Try again
					</button>
				</div>
			) : visibleData && visibleData.files.length > 0 ? (
				<ProjectMapAtlas data={visibleData} project={project} />
			) : (
				<div {...stylex.props(styles.centerState)}>
					<p {...stylex.props(styles.centerText)}>
						No supported source files were found in this project.
					</p>
				</div>
			)}
		</div>
	);
}

const styles = stylex.create({
	root: {
		position: "relative",
		height: "100%",
		minHeight: controlSize._0,
		overflow: "hidden",
		backgroundColor: color.background,
	},
	projectPicker: {
		position: "absolute",
		zIndex: layer.popover,
		top: controlSize._3,
		left: controlSize._3,
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
	},
	dropdownButton: {
		height: controlSize._7,
		borderRadius: radius.lg,
		borderColor: color.borderStrong,
		backgroundColor: color.surfaceTranslucent,
		backdropFilter: "blur(18px)",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		paddingInline: controlSize._2_5,
	},
	dropdownLabel: {
		maxWidth: "128px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	branchPill: {
		display: {
			default: "none",
			[breakpoint.standard]: "flex",
		},
		height: controlSize._7,
		alignItems: "center",
		gap: controlSize._1_5,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.lg,
		backgroundColor: color.surfaceTranslucent,
		backdropFilter: "blur(18px)",
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		paddingInline: controlSize._2_5,
	},
	centerState: {
		display: "flex",
		height: "100%",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._3,
	},
	centerText: {
		maxWidth: "24rem",
		color: color.textMuted,
		fontSize: font.size_3,
		textAlign: "center",
	},
	errorTitle: {
		color: color.textMain,
		fontSize: font.size_5,
		fontWeight: font.weight_6,
	},
	retryButton: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.md,
		backgroundColor: color.surfaceControl,
		color: color.textMain,
		fontSize: font.size_2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	loadingMark: {
		display: "flex",
		gap: controlSize._1,
		alignItems: "flex-end",
		height: controlSize._8,
		color: color.accent,
	},
	loadingBar: {
		display: "block",
		width: controlSize._2,
		backgroundColor: color.accent,
		transform: "skewY(-28deg)",
		animationName: "atlas-load",
		animationDuration: motion.durationLongest,
		animationIterationCount: "infinite",
		animationTimingFunction: "ease-in-out",
	},
	loadingBarOne: { height: controlSize._4 },
	loadingBarTwo: { height: controlSize._6, animationDelay: "120ms" },
	loadingBarThree: { height: controlSize._8, animationDelay: "240ms" },
});
