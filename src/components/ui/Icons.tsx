import type { Octane } from "octane/jsx-runtime";
import type { CSSProperties } from "react";
import { hasId } from "../../lib/data.ts";

export type IconProps = Octane.SVGProps<SVGSVGElement> & { size?: number };

function icon(paths: string | string[], viewBox = "0 0 24 24") {
	const pathList = Array.isArray(paths) ? paths : [paths];
	return function Icon({ size = 16, ...props }: IconProps) {
		return (
			<svg
				aria-hidden="true"
				xmlns="http://www.w3.org/2000/svg"
				width={size}
				height={size}
				viewBox={viewBox}
				fill="none"
				stroke="currentColor"
				strokeWidth={1.75}
				strokeLinecap="round"
				strokeLinejoin="round"
				{...props}
			>
				{pathList.map((d) => (
					<path key={d} d={d} />
				))}
			</svg>
		);
	};
}

function svgIcon(
	children: unknown,
	options: { viewBox?: string; fill?: string; stroke?: string | null } = {},
) {
	return function Icon({ size = 16, ...props }: IconProps) {
		return (
			<svg
				aria-hidden="true"
				xmlns="http://www.w3.org/2000/svg"
				width={size}
				height={size}
				viewBox={options.viewBox ?? "0 0 24 24"}
				fill={options.fill ?? "none"}
				stroke={
					options.stroke === null
						? undefined
						: (options.stroke ?? "currentColor")
				}
				strokeWidth={options.stroke === null ? undefined : 1.75}
				strokeLinecap={options.stroke === null ? undefined : "round"}
				strokeLinejoin={options.stroke === null ? undefined : "round"}
				{...props}
			>
				{children}
			</svg>
		);
	};
}

export const {
	IconAgent,
	IconX,
	IconPlus,
	IconMinus,
	IconCheck,
	IconRefreshCw,
	IconTrash,
	IconLayoutRows,
	IconFolder,
	IconFolderOpen,
	IconMic,
	IconPencil,
	IconGlobe,
	IconWrench,
	IconAlertTriangle,
	IconCode,
	IconRobot,
	IconSlash,
	IconFilePlus,
	IconClock,
	IconWorkflow,
	IconCopy,
	IconSend,
	IconHelpCircle,
	IconArrowDown,
	IconArrowUp,
	IconTag,
	IconCloud,
	IconPanelLeft,
	IconExternalLink,
	IconArrowLeft,
	IconMessageCircle,
	IconExpand,
	IconCollapse,
	IconChevronRight,
	IconChevronDown,
	IconLayoutGrid,
	IconTarget,
	IconLoader,
	IconSparkles,
} = {
	IconAgent: icon(["M4 17l6-6-6-6", "M12 19h8"]),
	IconX: icon("M18 6L6 18M6 6l12 12"),
	IconPlus: icon("M12 5v14M5 12h14"),
	IconMinus: icon("M5 12h14"),
	IconCheck: icon("M20 6L9 17l-5-5"),
	IconRefreshCw: icon([
		"M21 12a9 9 0 0 0-15.5-6.3L3 8",
		"M3 3v5h5",
		"M3 12a9 9 0 0 0 15.5 6.3L21 16",
		"M21 21v-5h-5",
	]),
	IconTrash: icon([
		"M3 6h18",
		"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
	]),
	IconLayoutRows: icon(["M3 3h5v18H3z", "M10 3h5v18h-5z", "M17 3h5v18h-5z"]),
	IconFolder: icon(
		"M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
	),
	IconFolderOpen: icon([
		"M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v1",
		"M5 21l3-9h16l-3 9",
	]),
	IconMic: icon([
		"M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z",
		"M19 10v2a7 7 0 0 1-14 0v-2",
		"M12 19v3",
		"M8 22h8",
	]),
	IconPencil: icon(["M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"]),
	IconGlobe: icon([
		"M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z",
		"M2 12h20",
		"M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
	]),
	IconWrench: icon([
		"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
	]),
	IconAlertTriangle: icon([
		"M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
		"M12 9v4",
		"M12 17h.01",
	]),
	IconCode: icon(["M16 18l6-6-6-6", "M8 6l-6 6 6 6"]),
	IconRobot: icon([
		"M12 2a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1v4a2 2 0 0 1-2 2v2h-1v-2h-2v2h-1v-2H8a2 2 0 0 1-2-2v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3V4a2 2 0 0 1 2-2z",
		"M9 10h.01",
		"M15 10h.01",
	]),
	IconSlash: icon([
		"M3.5 5h17a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-17a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z",
		"M8 10l3 2-3 2",
		"M14 14h3",
	]),
	IconFilePlus: icon([
		"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
		"M14 2v6h6",
		"M12 18v-6",
		"M9 15h6",
	]),
	IconClock: icon([
		"M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z",
		"M12 6v6l4 2",
	]),
	IconWorkflow: icon([
		"M5 6a3 3 0 1 0 0.01 0",
		"M19 6a3 3 0 1 0 0.01 0",
		"M12 18a3 3 0 1 0 0.01 0",
		"M8 6h8",
		"M6.7 8.4 10.6 7.2",
		"M17.3 8.4 6.7 15.6",
	]),
	IconCopy: icon([
		"M9 9h13v13H9z",
		"M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
	]),
	IconSend: icon(["M22 2 11 13", "M22 2 15 22 11 13 2 9 22 2"], "0 0 24 24"),
	IconHelpCircle: icon([
		"M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z",
		"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",
		"M12 17h.01",
	]),
	IconArrowDown: icon(["M12 2v20", "M5 15l7 7 7-7"]),
	IconArrowUp: icon(["M12 22V2", "M5 9l7-7 7 7"]),
	IconTag: icon(["M2 12l10 10 10-10-10-10H2z", "M7 7h.01"]),
	IconCloud: icon([
		"M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.7-1.5A3.5 3.5 0 0 0 7 18z",
	]),
	IconPanelLeft: icon([
		"M3 3h18a0 0 0 0 1 0 0v18a0 0 0 0 1 0 0H3a0 0 0 0 1 0 0V3z",
		"M9 3v18",
	]),
	IconExternalLink: icon([
		"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
		"M15 3h6v6",
		"M10 14L21 3",
	]),
	IconArrowLeft: icon("M19 12H5M12 19l-7-7 7-7"),
	IconMessageCircle: icon([
		"M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
	]),
	IconExpand: icon(["M15 3h6v6", "M21 3l-7 7", "M9 21H3v-6", "M3 21l7-7"]),
	IconCollapse: icon(["M10 14H4v6", "M4 20l7-7", "M14 10h6V4", "M20 4l-7 7"]),
	IconChevronRight: icon("M9 18l6-6-6-6"),
	IconChevronDown: icon("M6 9l6 6 6-6"),
	IconLayoutGrid: icon([
		"M3 3h7v7H3z",
		"M14 3h7v7h-7z",
		"M3 14h7v7H3z",
		"M14 14h7v7h-7z",
	]),
	IconTarget: icon([
		"M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z",
		"M12 18c3.31 0 6-2.69 6-6s-2.69-6-6-6-6 2.69-6 6 2.69 6 6 6z",
		"M12 14c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z",
	]),
	IconLoader: icon([
		"M12 2v4",
		"M12 18v4",
		"M4.93 4.93l2.83 2.83",
		"M16.24 16.24l2.83 2.83",
		"M2 12h4",
		"M18 12h4",
		"M4.93 19.07l2.83-2.83",
		"M16.24 7.76l2.83-2.83",
	]),
	IconSparkles: icon([
		"M12 3l1.1 3.1L16 7.5l-2.9 1.4L12 12l-1.1-3.1L8 7.5l2.9-1.4L12 3z",
		"M18.5 13l.7 2 1.8.8-1.8.8-.7 2-.7-2-1.8-.8 1.8-.8.7-2z",
		"M5.5 14l.8 2.3 2.2 1-2.2 1-.8 2.2-.8-2.2-2.2-1 2.2-1 .8-2.3z",
	]),
};

export const {
	IconGitBranch,
	IconEye,
	IconSearch,
	IconGitCommit,
	IconStop,
	IconFolderFill,
	IconAnthropic,
	IconOpenAI,
	IconUser,
	IconSettings,
} = {
	IconGitBranch: svgIcon(
		<>
			<line x1="6" y1="3" x2="6" y2="15" />
			<circle cx="18" cy="6" r="3" />
			<circle cx="6" cy="18" r="3" />
			<path d="M18 9a9 9 0 0 1-9 9" />
		</>,
	),
	IconEye: svgIcon(
		<>
			<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
			<circle cx="12" cy="12" r="3" />
		</>,
	),
	IconSearch: svgIcon(
		<>
			<circle cx="11" cy="11" r="8" />
			<line x1="21" y1="21" x2="16.65" y2="16.65" />
		</>,
	),
	IconGitCommit: svgIcon(
		<>
			<circle cx="12" cy="12" r="4" />
			<line x1="1.05" y1="12" x2="7" y2="12" />
			<line x1="17.01" y1="12" x2="22.96" y2="12" />
		</>,
	),
	IconStop: svgIcon(
		<>
			<rect x="6" y="6" width="12" height="12" rx="1" />
		</>,
		{ fill: "currentColor", stroke: null },
	),
	IconFolderFill: svgIcon(
		<>
			<path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
		</>,
		{ fill: "currentColor", stroke: null },
	),
	IconAnthropic: svgIcon(
		<>
			<path d="M 233.96 800.21 L 468.64 668.54 L 472.59 657.1 L 468.64 650.74 L 457.21 650.74 L 417.99 648.32 L 283.89 644.7 L 167.6 639.87 L 54.93 633.83 L 26.58 627.79 L 0 592.75 L 2.74 575.28 L 26.58 559.25 L 60.72 562.23 L 136.19 567.38 L 249.42 575.19 L 331.57 580.03 L 453.26 592.67 L 472.59 592.67 L 475.33 584.86 L 468.72 580.03 L 463.57 575.19 L 346.39 495.79 L 219.54 411.87 L 153.1 363.54 L 117.18 339.06 L 99.06 316.11 L 91.25 266.01 L 123.87 230.09 L 167.68 233.07 L 178.87 236.05 L 223.25 270.2 L 318.04 343.57 L 441.83 434.74 L 459.95 449.8 L 467.19 444.64 L 468.08 441.02 L 459.95 427.41 L 392.62 305.72 L 320.78 181.93 L 288.81 130.63 L 280.35 99.87 C 277.37 87.22 275.19 76.59 275.19 63.62 L 312.32 13.21 L 332.86 6.6 L 382.39 13.21 L 403.25 31.33 L 434.01 101.72 L 483.87 212.54 L 561.18 363.22 L 583.81 407.92 L 595.89 449.32 L 600.4 461.96 L 608.21 461.96 L 608.21 454.71 L 614.58 369.83 L 626.34 265.61 L 637.77 131.52 L 641.72 93.75 L 660.4 48.48 L 697.53 24 L 726.52 37.85 L 750.36 72 L 747.06 94.07 L 732.89 186.2 L 705.1 330.52 L 686.98 427.17 L 697.53 427.17 L 709.61 415.09 L 758.5 350.17 L 840.64 247.49 L 876.89 206.74 L 919.17 161.72 L 946.31 140.3 L 997.61 140.3 L 1035.38 196.43 L 1018.47 254.42 L 965.64 321.42 L 921.83 378.2 L 859.01 462.77 L 819.79 530.42 L 823.41 535.81 L 832.75 534.93 L 974.66 504.72 L 1051.33 490.87 L 1142.82 475.17 L 1184.21 494.5 L 1188.72 514.15 L 1172.46 554.34 L 1074.6 578.5 L 959.84 601.45 L 788.94 641.88 L 786.85 643.41 L 789.26 646.39 L 866.26 653.64 L 899.19 655.41 L 979.81 655.41 L 1129.93 666.6 L 1169.15 692.54 L 1192.67 724.27 L 1188.72 748.43 L 1128.32 779.19 L 1046.82 759.87 L 856.59 714.6 L 791.36 698.34 L 782.34 698.34 L 782.34 703.73 L 836.7 756.89 L 936.32 846.85 L 1061.07 962.82 L 1067.44 991.49 L 1051.41 1014.12 L 1034.5 1011.7 L 924.89 929.23 L 882.6 892.11 L 786.85 811.49 L 780.48 811.49 L 780.48 819.95 L 802.55 852.24 L 919.09 1027.41 L 925.13 1081.13 L 916.67 1098.6 L 886.47 1109.15 L 853.29 1103.11 L 785.07 1007.36 L 714.68 899.52 L 657.91 802.87 L 650.98 806.82 L 617.48 1167.7 L 601.77 1186.15 L 565.53 1200 L 535.33 1177.05 L 519.3 1139.92 L 535.33 1066.55 L 554.66 970.79 L 570.36 894.68 L 584.54 800.13 L 592.99 768.72 L 592.43 766.63 L 585.5 767.52 L 514.23 865.37 L 405.83 1011.87 L 320.05 1103.68 L 299.52 1111.81 L 263.92 1093.37 L 267.22 1060.43 L 287.11 1031.11 L 405.83 880.11 L 477.42 786.52 L 523.65 732.48 L 523.33 724.67 L 520.59 724.67 L 205.29 929.4 L 149.15 936.64 L 124.99 914.01 L 127.97 876.89 L 139.41 864.81 L 234.2 799.57 L 233.88 799.89 Z" />
		</>,
		{ viewBox: "0 0 1200 1200", fill: "#d97757", stroke: null },
	),
	IconOpenAI: svgIcon(
		<>
			<path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
		</>,
		{ fill: "#ffffff", stroke: null },
	),
	IconUser: svgIcon(
		<>
			<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
			<circle cx="12" cy="7" r="4" />
		</>,
	),
	IconSettings: svgIcon(
		<>
			<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
			<circle cx="12" cy="12" r="3" />
		</>,
	),
};

export function CommitGraphLinesLayer({
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
}

export function ProjectGraphConnectionsLayer({
	nodes,
	hoveredNodeId,
	selectedNodeId,
	className,
}: {
	nodes: ReadonlyArray<{
		id: string;
		x: number;
		y: number;
		connections: readonly string[];
	}>;
	hoveredNodeId: string | null;
	selectedNodeId: string | null;
	className?: string;
}) {
	return (
		<svg aria-hidden="true" className={className}>
			{nodes.flatMap((node) =>
				node.connections.map((targetId) => {
					const target = nodes.find(hasId.bind(null, targetId));
					if (!target) return null;
					const active =
						hoveredNodeId === node.id ||
						hoveredNodeId === targetId ||
						selectedNodeId === node.id ||
						selectedNodeId === targetId;
					return (
						<line
							key={`${node.id}-${targetId}`}
							x1={node.x + 56}
							y1={node.y + 16}
							x2={target.x + 56}
							y2={target.y + 16}
							stroke={
								active ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.1)"
							}
							strokeDasharray={active ? "none" : "4 4"}
							strokeWidth={active ? 1.5 : 1}
						/>
					);
				}),
			)}
		</svg>
	);
}
