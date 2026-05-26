import type { ReactNode } from "react";
import { Icons } from "./inferay/Icons";

export type Pane = {
	id: string;
	agent: "codex" | "claude";
	folder: string | null;
	title: string;
	branch: string;
	status: "editing" | "reading" | "idle" | "starting";
	mode?: "chat" | "start";
	messages: Array<
		| { role: "user"; text: string }
		| { role: "assistant"; text: string }
		| { role: "tool"; name: string; detail: string; diff?: boolean }
	>;
};

const panes: Pane[] = [
	{
		id: "site",
		agent: "codex",
		folder: "inferay",
		title: "Files library",
		branch: "main",
		status: "editing",
		messages: [
			{
				role: "user",
				text: "Make Images a Files page with selection, details, delete, and chat handoff.",
			},
			{
				role: "assistant",
				text: "Reworking the page around the app shell patterns: centered table, local selection state, row metadata, and chat handoff without adding downloads.",
			},
			{
				role: "tool",
				name: "Edit",
				detail: "src/pages/ImagesPage/index.tsx",
				diff: true,
			},
		],
	},
	{
		id: "files",
		agent: "claude",
		folder: "inferay",
		title: "Files workflow",
		branch: "main",
		status: "reading",
		messages: [
			{
				role: "user",
				text: "Check the inline folder picker and composer spacing.",
			},
			{
				role: "assistant",
				text: "The folder picker stays docked at the bottom of an empty pane; the composer keeps its file and command affordances inside the input frame.",
			},
			{
				role: "tool",
				name: "Read",
				detail: "src/pages/Terminal/InlineDirectoryPicker.tsx",
			},
		],
	},
	{
		id: "picker",
		agent: "codex",
		folder: null,
		title: "New Session",
		branch: "main",
		status: "starting",
		mode: "start",
		messages: [],
	},
	{
		id: "diff",
		agent: "codex",
		folder: "inferay",
		title: "Diff review",
		branch: "main",
		status: "idle",
		messages: [
			{
				role: "user",
				text: "Review the inline diff surface against the real app.",
			},
			{
				role: "assistant",
				text: "The diff card keeps the same dark file header, tabular line numbers, green additions, and red removals used in chat tool output.",
			},
			{
				role: "tool",
				name: "Edit",
				detail: "src/components/chat/ChatComposer.tsx",
				diff: true,
			},
		],
	},
	{
		id: "files-page",
		agent: "claude",
		folder: "inferay",
		title: "Files handoff",
		branch: "main",
		status: "reading",
		messages: [
			{
				role: "user",
				text: "Make selected files start a chat without adding download actions.",
			},
			{
				role: "assistant",
				text: "Selection stays local to Files, then the selected paths are passed into a chat pane as context.",
			},
			{
				role: "tool",
				name: "Read",
				detail: "src/pages/ImagesPage/index.tsx",
			},
		],
	},
	{
		id: "release",
		agent: "codex",
		folder: "site",
		title: "Site build",
		branch: "main",
		status: "idle",
		messages: [
			{
				role: "user",
				text: "Check the site build after removing app-internal imports.",
			},
			{
				role: "assistant",
				text: "The marketing site now owns its static replica and builds without pulling desktop hooks into Vercel.",
			},
			{
				role: "tool",
				name: "Bash",
				detail: "bun run build\n[build] Complete!",
			},
		],
	},
];

const navRoutes = [
	{ label: "Prompts", icon: <Icons.File /> },
	{ label: "Goals", icon: <Icons.Check /> },
	{ label: "Files", icon: <Icons.FilePlus /> },
];

const scrollNotes = [
	"Checking the shell spacing against the current desktop layout.",
	"Keeping route and page behavior as wiring while the package-owned logic stays outside the replica.",
	"Matching the dark pane headers, thin borders, compact text scale, and bottom composer treatment.",
	"Leaving this as static site UI so Vercel never imports desktop runtime hooks.",
	"Verifying the message region scrolls independently from the fixed composer surface.",
	"Keeping the tool activity pill available without shifting the pane layout.",
	"Preserving the same workspace/sidebar density as the desktop shell.",
	"Using prepared product-like content instead of a decorative marketing mock.",
];

function AgentGlyph({
	agent,
	size = 12,
}: {
	agent: Pane["agent"];
	size?: number;
}) {
	if (agent === "claude") {
		return (
			<svg
				aria-hidden="true"
				width={size}
				height={size}
				viewBox="0 0 1200 1200"
				fill="currentColor"
				className="shrink-0 text-[#d97757]"
			>
				<path d="M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647 L 468.644287 650.738403 L 457.208069 650.738403 L 417.986633 648.322144 L 283.892639 644.69812 L 167.597321 639.865845 L 54.926208 633.825623 L 26.577238 627.785339 L 3.3e-05 592.751709 L 2.73832 575.27533 L 26.577238 559.248352 L 60.724873 562.228149 L 136.187973 567.382629 L 249.422867 575.194763 L 331.570496 580.026978 L 453.261841 592.671082 L 472.590637 592.671082 L 475.328857 584.859009 L 468.724915 580.026978 L 463.570557 575.194763 L 346.389313 495.785217 L 219.543671 411.865906 L 153.100723 363.543762 L 117.181267 339.060425 L 99.060455 316.107361 L 91.248367 266.01355 L 123.865784 230.093994 L 167.677887 233.073853 L 178.872513 236.053772 L 223.248367 270.201477 L 318.040283 343.570496 L 441.825592 434.738342 L 459.946411 449.798706 L 467.194672 444.64447 L 468.080597 441.020203 L 459.946411 427.409485 L 392.617493 305.718323 L 320.778564 181.932983 L 288.80542 130.630859 L 280.348999 99.865845 C 277.369171 87.221436 275.194641 76.590698 275.194641 63.624268 L 312.322174 13.20813 L 332.8591 6.604126 L 382.389313 13.20813 L 403.248352 31.328979 L 434.013519 101.71814 L 483.865753 212.537048 L 561.181274 363.221497 L 583.812134 407.919434 L 595.892639 449.315491 L 600.40271 461.959839 L 608.214783 461.959839 L 608.214783 454.711609 L 614.577271 369.825623 L 626.335632 265.61084 L 637.771851 131.516846 L 641.718201 93.745117 L 660.402832 48.483276 L 697.530334 24.000122 L 726.52356 37.852417 L 750.362549 72 L 747.060486 94.067139 L 732.886047 186.201416 L 705.100708 330.52356 L 686.979919 427.167847 L 697.530334 427.167847 L 709.61084 415.087341 L 758.496704 350.174561 L 840.644348 247.490051 L 876.885925 206.738342 L 919.167847 161.71814 L 946.308838 140.29541 L 997.61084 140.29541 L 1035.38269 196.429626 L 1018.469849 254.416199 L 965.637634 321.422852 L 921.825562 378.201538 L 859.006714 462.765259 L 819.785278 530.41626 L 823.409424 535.812073 L 832.75177 534.92627 L 974.657776 504.724915 L 1051.328979 490.872559 L 1142.818848 475.167786 L 1184.214844 494.496582 L 1188.724854 514.147644 L 1172.456421 554.335693 L 1074.604126 578.496765 L 959.838989 601.449829 L 788.939636 641.879272 L 786.845764 643.409485 L 789.261841 646.389343 L 866.255127 653.637634 L 899.194702 655.409424 L 979.812134 655.409424 L 1129.932861 666.604187 L 1169.154419 692.537109 L 1192.671265 724.268677 L 1188.724854 748.429688 L 1128.322144 779.194641 L 1046.818848 759.865845 L 856.590759 714.604126 L 791.355774 698.335754 L 782.335693 698.335754 L 782.335693 703.731567 L 836.69812 756.885986 L 936.322205 846.845581 L 1061.073975 962.81897 L 1067.436279 991.490112 L 1051.409424 1014.120911 L 1034.496704 1011.704712 L 924.885986 929.234924 L 882.604126 892.107544 L 786.845764 811.48999 L 780.483276 811.48999 L 780.483276 819.946289 L 802.550415 852.241699 L 919.087341 1027.409424 L 925.127625 1081.127686 L 916.671204 1098.604126 L 886.469849 1109.154419 L 853.288696 1103.114136 L 785.073914 1007.355835 L 714.684631 899.516785 L 657.906067 802.872498 L 650.979858 806.81897 L 617.476624 1167.704834 L 601.771851 1186.147705 L 565.530212 1200 L 535.328857 1177.046997 L 519.302124 1139.919556 L 535.328857 1066.550537 L 554.657776 970.792053 L 570.362488 894.68457 L 584.536926 800.134277 L 592.993347 768.724976 L 592.429626 766.630859 L 585.503479 767.516968 L 514.22821 865.369263 L 405.825531 1011.865906 L 320.053711 1103.677979 L 299.516815 1111.812256 L 263.919525 1093.369263 L 267.221497 1060.429688 L 287.114136 1031.114136 L 405.825531 880.107361 L 477.422913 786.52356 L 523.651062 732.483276 L 523.328918 724.671265 L 520.590698 724.671265 L 205.288605 929.395935 L 149.154434 936.644409 L 124.993355 914.01355 L 127.973183 876.885986 L 139.409409 864.80542 L 234.201385 799.570435 L 233.879227 799.8927 Z" />
			</svg>
		);
	}
	return (
		<svg
			aria-hidden="true"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			className="shrink-0 text-inferay-soft-white"
		>
			<path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
		</svg>
	);
}

function SidebarPane({ pane, active }: { pane: Pane; active?: boolean }) {
	return (
		<button
			type="button"
			className={`mb-0.5 flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left ${
				active
					? "border-inferay-gray-border bg-white/[0.045] text-inferay-white"
					: "border-transparent text-inferay-soft-white"
			}`}
		>
			<AgentGlyph agent={pane.agent} />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[10px] font-medium leading-tight text-inferay-muted-gray">
					{pane.folder ?? "New Session"}
				</span>
				<span className="block truncate text-[11px] font-medium leading-tight">
					{pane.title}
				</span>
			</span>
		</button>
	);
}

function Sidebar() {
	return (
		<aside className="flex w-48 shrink-0 select-none flex-col overflow-hidden border-r border-inferay-gray-border bg-inferay-black">
			<div className="flex h-12 shrink-0 items-center border-b border-inferay-gray-border px-3">
				<button className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md">
					<img
						src="/app-icon.png"
						alt=""
						className="h-7 w-7 rounded-md object-cover"
					/>
				</button>
			</div>
			<nav className="min-h-0 flex-1 overflow-y-auto py-1.5">
				<div className="px-1.5">
					{navRoutes.map((route) => (
						<button
							type="button"
							key={route.label}
							className="mb-1 flex h-7 w-full items-center gap-2 rounded-lg border border-transparent px-2 text-[11px] font-medium text-inferay-soft-white hover:bg-inferay-dark-gray hover:text-inferay-white"
						>
							<span className="w-4 shrink-0">{route.icon}</span>
							<span>{route.label}</span>
						</button>
					))}
				</div>

				<div className="mt-2 border-t border-inferay-gray-border pt-2">
					<div className="mb-1 flex items-center justify-between px-3">
						<span className="text-[11px] font-medium uppercase tracking-normal text-inferay-soft-white">
							Workspaces
						</span>
						<button className="flex h-5 w-5 items-center justify-center rounded text-inferay-muted-gray">
							<Icons.Plus />
						</button>
					</div>
					<div className="mx-1.5 mb-1">
						<div className="mb-1 flex h-8 items-center gap-2 rounded-lg border border-transparent px-2 text-[11px] font-medium text-inferay-soft-white">
							<Icons.Chevron />
							<span className="min-w-0 flex-1 truncate">Main</span>
							<span className="text-[10px] text-inferay-soft-white">6</span>
						</div>
						{panes.map((pane, index) => (
							<SidebarPane key={pane.id} pane={pane} active={index === 0} />
						))}
					</div>
				</div>
			</nav>
			<div className="flex shrink-0 flex-col gap-1 border-t border-inferay-gray-border p-1.5">
				<button className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-[11px] font-medium text-inferay-soft-white">
					<Icons.Settings />
					<span>Settings</span>
				</button>
				<button className="flex h-7 w-full items-center gap-2 rounded-lg px-1.5 text-[11px] font-medium text-inferay-soft-white">
					<span className="flex h-5 w-5 items-center justify-center rounded-full border border-inferay-gray-border bg-inferay-dark-gray text-[9px] uppercase">
						ra
					</span>
				</button>
			</div>
		</aside>
	);
}

function HeaderTab({
	active,
	icon,
	label,
}: {
	active?: boolean;
	icon: ReactNode;
	label: string;
}) {
	return (
		<button
			type="button"
			className={`flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium ${
				active
					? "border-inferay-gray-border bg-white/[0.055] text-inferay-white"
					: "border-transparent text-inferay-soft-white"
			}`}
		>
			{icon}
			<span>{label}</span>
		</button>
	);
}

function TerminalShellHeader() {
	return (
		<header className="flex h-12 shrink-0 select-none items-center gap-3 border-b border-inferay-gray-border bg-inferay-black px-3">
			<div className="flex items-center gap-1">
				<HeaderTab active icon={<Icons.Chat />} label="Chat" />
				<HeaderTab icon={<Icons.Code />} label="Editor" />
				<HeaderTab icon={<Icons.Git />} label="Changes" />
				<HeaderTab icon={<Icons.Graph />} label="Graph" />
			</div>
			<span className="min-w-0 flex-1" />
			<div className="flex items-center gap-3">
				<div className="flex items-center gap-1.5 text-[10px] text-inferay-muted-gray">
					<span>Col</span>
					<span className="rounded-md border border-inferay-gray-border bg-inferay-dark-gray px-2 py-1 font-mono text-inferay-soft-white">
						3
					</span>
				</div>
				<div className="flex items-center gap-1.5 text-[10px] text-inferay-muted-gray">
					<span>Row</span>
					<span className="rounded-md border border-inferay-gray-border bg-inferay-dark-gray px-2 py-1 font-mono text-inferay-soft-white">
						2
					</span>
				</div>
				<div className="flex h-7 overflow-hidden rounded-lg border border-inferay-gray-border bg-inferay-dark-gray">
					<button className="flex w-7 items-center justify-center bg-white/[0.055] text-inferay-white">
						<Icons.Context />
					</button>
					<button className="flex w-7 items-center justify-center border-l border-inferay-gray-border text-inferay-muted-gray">
						<Icons.Stack />
					</button>
				</div>
				<button className="flex h-7 items-center gap-1.5 rounded-lg border border-inferay-gray-border bg-inferay-dark-gray px-2 text-[11px] font-medium text-inferay-white">
					<span>New</span>
					<Icons.Plus />
				</button>
			</div>
		</header>
	);
}

function ToolStatus({ status }: { status: Pane["status"] }) {
	if (status === "idle") return null;
	const detail = status === "editing" ? "Editing files" : "Reading files";
	const activities =
		status === "editing"
			? [
					["Edit", "src/pages/ImagesPage/index.tsx"],
					["Read", "src/components/chat/ChatComposer.tsx"],
					["Bash", "bunx tsc --noEmit --pretty false"],
				]
			: [
					["Read", "src/pages/Terminal/InlineDirectoryPicker.tsx"],
					["Read", "src/components/chat/AgentChatStatusBar.tsx"],
					["Grep", "message composer status bar"],
				];
	return (
		<div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1">
			<div className="group relative">
				<div className="flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-inferay-gray-border bg-inferay-dark-gray px-2 text-[12px] font-medium text-inferay-soft-white">
					{status === "editing" ? <Icons.Edit /> : <Icons.Eye />}
					<span className="max-w-[150px] truncate">{detail}</span>
					<span className="font-mono text-[9px] text-inferay-muted-gray">
						+2
					</span>
				</div>
				<div className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden w-64 overflow-hidden rounded-lg border border-inferay-gray-border bg-inferay-dark-gray shadow-[0_16px_40px_rgba(0,0,0,0.7)] group-hover:block">
					<div className="flex items-center justify-between border-b border-inferay-gray-border px-2.5 py-1.5 text-[9px] font-medium uppercase text-inferay-muted-gray">
						<span>Activity</span>
						<span>{activities.length}</span>
					</div>
					{activities.map(([tool, summary], index) => (
						<div
							key={`${tool}-${summary}`}
							className={`flex items-center gap-2 px-2.5 py-1.5 text-[10px] ${
								index < activities.length - 1
									? "border-b border-white/[0.04]"
									: ""
							}`}
						>
							<span className="w-9 shrink-0 font-mono text-inferay-muted-gray">
								{tool}
							</span>
							<span className="min-w-0 flex-1 truncate text-inferay-soft-white">
								{summary}
							</span>
							<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-inferay-muted-gray" />
						</div>
					))}
				</div>
			</div>
			<button className="flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-inferay-gray-border bg-inferay-dark-gray px-2 text-[12px] font-medium text-inferay-soft-white">
				<Icons.Pause />
				Stop
			</button>
		</div>
	);
}

function MiniDiff() {
	const rows = [
		["@", "", "", "@@ -42,7 +42,7 @@"],
		["-", "42", "", 'const pageTitle = "Images";'],
		["+", "", "42", 'const pageTitle = "Files";'],
		[" ", "43", "43", ""],
		["-", "44", "", "<ImageGrid items={images} />"],
		["+", "", "44", "<FileRows files={files} />"],
		[" ", "45", "45", "<FileActions selected={selected} />"],
	];
	return (
		<div className="overflow-hidden rounded-lg border border-inferay-gray-border bg-[#050505]">
			<div className="flex h-7 items-center gap-1.5 border-b border-inferay-gray-border px-2">
				<Icons.FilePlus />
				<span className="min-w-0 flex-1 truncate font-mono text-[10px] text-inferay-soft-white">
					src/pages/ImagesPage/index.tsx
				</span>
				<span className="font-mono text-[10px] text-green-400">+2</span>
				<span className="font-mono text-[10px] text-red-400">-2</span>
			</div>
			<div className="max-h-36 overflow-hidden font-mono">
				{rows.map(([sign, oldLine, newLine, text], index) => (
					<div
						key={index}
						className={`flex h-[18px] items-center border-l-2 text-[10px] ${
							sign === "+"
								? "border-green-500/40 bg-green-500/[0.08]"
								: sign === "-"
									? "border-red-500/40 bg-red-500/[0.08]"
									: sign === "@"
										? "border-inferay-gray-border bg-white/[0.04]"
										: "border-transparent"
						}`}
					>
						<span
							className={`w-4 shrink-0 text-center ${
								sign === "+"
									? "text-green-400"
									: sign === "-"
										? "text-red-400"
										: sign === "@"
											? "text-inferay-muted-gray"
											: "text-inferay-muted-gray"
							}`}
						>
							{sign}
						</span>
						<span className="grid w-12 shrink-0 grid-cols-2 text-right text-[9px] text-inferay-muted-gray">
							<span className="pr-1">{oldLine}</span>
							<span className="pr-2">{newLine}</span>
						</span>
						<span className="min-w-0 flex-1 truncate text-inferay-white">
							{text || " "}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function ChatMessages({ pane }: { pane: Pane }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
			{pane.messages.map((message, index) => {
				if (message.role === "user") {
					return (
						<div key={index} className="flex justify-end">
							<div className="max-w-[85%] rounded-lg rounded-br-sm px-2.5 py-1.5 text-[12px] leading-relaxed text-inferay-white">
								{message.text}
							</div>
						</div>
					);
				}
				if (message.role === "tool") {
					return message.diff ? (
						<MiniDiff key={index} />
					) : (
						<div key={index}>
							<button className="flex items-center gap-1 text-[11px] text-inferay-muted-gray">
								<Icons.Chevron />
								<span className="font-mono">{message.name}</span>
							</button>
							<pre className="mt-1 max-h-20 overflow-hidden rounded-md bg-inferay-dark-gray px-2 py-1.5 font-mono text-[10px] leading-relaxed text-inferay-muted-gray">
								{message.detail}
							</pre>
						</div>
					);
				}
				return (
					<p
						key={index}
						className="m-0 text-[12px] leading-relaxed text-inferay-soft-white"
					>
						{message.text}
					</p>
				);
			})}
			{scrollNotes.map((note, index) => (
				<p
					key={`${pane.id}-scroll-note-${index}`}
					className="m-0 text-[12px] leading-relaxed text-inferay-muted-gray"
				>
					{note}
				</p>
			))}
		</div>
	);
}

function Composer({ pane }: { pane: Pane }) {
	if (pane.mode === "start") return null;
	return (
		<div className="relative shrink-0">
			<div className="pointer-events-none absolute inset-x-0 bottom-full h-12 bg-gradient-to-t from-inferay-black to-transparent" />
			<ToolStatus status={pane.status} />
			<div className="px-3 pb-2 pt-1">
				<div className="relative flex flex-col overflow-visible rounded-xl border border-inferay-gray-border bg-inferay-dark-gray">
					<div className="flex items-end gap-1 px-1 py-1.5 pr-3">
						<button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-inferay-muted-gray">
							<Icons.Plus />
						</button>
						<div className="min-h-5 min-w-0 flex-1 py-0.5 text-[13px] leading-5 text-inferay-muted-gray">
							Message... (/ commands, @ files)
						</div>
					</div>
					<div className="flex min-w-0 items-center gap-1.5 overflow-x-auto px-2 pb-1.5">
						<button className="flex h-5 items-center gap-1 rounded-md px-1 text-[10px] font-medium text-inferay-accent">
							<AgentGlyph agent={pane.agent} size={10} />
							{pane.agent === "codex" ? "Codex" : "Claude"}
							<Icons.Chevron />
						</button>
						<button className="flex h-5 items-center gap-1 rounded-md px-1 text-[10px] font-medium text-inferay-muted-gray">
							{pane.agent === "codex" ? "GPT-5.5" : "Opus 4.7"}
							<Icons.Chevron />
						</button>
						{pane.agent === "codex" && (
							<button className="flex h-5 items-center gap-1 rounded-md px-1 text-[10px] font-medium text-inferay-muted-gray">
								Low
								<Icons.Chevron />
							</button>
						)}
						<span className="flex-1" />
					</div>
				</div>
			</div>
		</div>
	);
}

const quickPicks = [
	{
		name: "inferay",
		path: "~/Developer/inferay",
		isGitRepo: true,
		active: true,
	},
	{
		name: "folcmoot-v1",
		path: "~/Developer/folcmoot-v1",
		isGitRepo: true,
	},
	{
		name: "Surgent-Marketing",
		path: "~/Developer/Surgent-Marketing",
		isGitRepo: true,
	},
	{
		name: "aivre-mobile-v2",
		path: "~/Developer/aivre-mobile-v2",
		isGitRepo: true,
	},
];

function InlineDirectoryPickerReplica() {
	return (
		<div className="relative w-full">
			<div className="flex w-full flex-col overflow-hidden rounded-xl border border-inferay-gray-border bg-inferay-dark-gray">
				<div className="flex max-h-[220px] flex-col overflow-hidden border-b border-white/[0.06] py-1">
					{quickPicks.map((pick) => (
						<button
							type="button"
							key={pick.path}
							className={`flex w-full items-center gap-2 px-3 py-[0.1875rem] text-left text-inferay-soft-white transition-colors ${
								pick.active ? "bg-white/[0.055] text-inferay-white" : ""
							}`}
						>
							<span
								className={`shrink-0 ${
									pick.active
										? "text-inferay-soft-white"
										: "text-inferay-muted-gray"
								}`}
							>
								{pick.isGitRepo ? <Icons.Branch /> : <Icons.Folder />}
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-[12px] font-medium leading-4">
									{pick.name}
								</span>
								<span className="block truncate text-[9px] leading-3 text-inferay-muted-gray">
									{pick.path}
								</span>
							</span>
							<span className="shrink-0 text-inferay-muted-gray">
								<Icons.Chevron />
							</span>
						</button>
					))}
				</div>
				<div className="flex items-center gap-2 px-3 py-2">
					<span className="shrink-0 text-inferay-muted-gray">
						<Icons.Folder />
					</span>
					<span className="min-w-0 flex-1 text-[13px] text-inferay-muted-gray">
						Search folder...
					</span>
				</div>
			</div>
		</div>
	);
}

function StartPane({ pane }: { pane: Pane }) {
	const composerPane: Pane = {
		...pane,
		mode: "chat",
		status: "idle",
	};
	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden bg-inferay-black">
			<header className="flex shrink-0 select-none items-center gap-1.5 border-b border-inferay-gray-border px-3 py-1.5">
				<span className="truncate text-[11px] font-medium text-inferay-white">
					New Session
				</span>
				<span className="flex-1" />
				<button className="flex h-4 w-4 items-center justify-center rounded text-inferay-muted-gray">
					<Icons.Close />
				</button>
			</header>
			<div className="relative min-h-0 flex-1 overflow-hidden">
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-2">
					<div className="pointer-events-auto mx-auto max-w-[42rem]">
						<InlineDirectoryPickerReplica />
					</div>
				</div>
			</div>
			<Composer pane={composerPane} />
		</section>
	);
}

export function ChatPane({
	pane,
	selected,
}: {
	pane: Pane;
	selected?: boolean;
}) {
	if (pane.mode === "start") return <StartPane pane={pane} />;
	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden bg-inferay-black">
			<header className="flex shrink-0 select-none items-center gap-1.5 border-b border-inferay-gray-border px-3 py-1.5">
				<span className="truncate text-[11px] font-medium text-inferay-white">
					{pane.folder}
				</span>
				<span className="text-[11px] text-inferay-muted-gray">›</span>
				<Icons.Branch />
				<span className="max-w-20 truncate text-[11px] font-medium text-inferay-muted-gray">
					{pane.branch}
				</span>
				<span className="flex-1" />
				{selected && (
					<span className="h-1.5 w-1.5 rounded-full bg-inferay-accent" />
				)}
				<button className="flex h-4 w-4 items-center justify-center rounded text-inferay-muted-gray">
					<Icons.Close />
				</button>
			</header>
			<ChatMessages pane={pane} />
			<Composer pane={pane} />
		</section>
	);
}

export function ProductGrid() {
	return (
		<main className="min-h-0 flex-1 overflow-hidden">
			<div className="grid h-full grid-cols-3 grid-rows-2 bg-inferay-black">
				{panes.map((pane, index) => {
					const rightEdge = index % 3 === 2;
					const bottomEdge = index >= 3;
					return (
						<div
							key={pane.id}
							className={`min-h-0 min-w-0 overflow-hidden border-inferay-gray-border ${
								rightEdge ? "" : "border-r"
							} ${bottomEdge ? "" : "border-b"}`}
						>
							<ChatPane pane={pane} selected={index === 0} />
						</div>
					);
				})}
			</div>
		</main>
	);
}

export function ProductFrame() {
	return (
		<div
			className="relative overflow-hidden rounded-xl border border-black/40 bg-inferay-black"
			style={{
				boxShadow:
					"inset 0 1px 0 rgba(255,255,255,0.1), 0 30px 90px rgba(0,0,0,0.58)",
			}}
		>
			<div className="flex h-6 shrink-0 items-center gap-1.5 bg-inferay-black px-3">
				<span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
				<span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
				<span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
			</div>
			<div className="flex h-[860px] bg-inferay-black">
				<Sidebar />
				<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
					<TerminalShellHeader />
					<ProductGrid />
				</div>
			</div>
		</div>
	);
}

export default function Inferay() {
	return (
		<section
			className="mb-24 animate-slide-up"
			style={{ animationDelay: "0.3s" }}
		>
			<div className="relative">
				<div
					className="absolute -inset-x-16 -inset-y-12 rounded-[4rem] opacity-90"
					style={{
						background:
							"radial-gradient(ellipse 70% 55% at 50% 50%, rgba(180,180,185,0.18) 0%, rgba(140,140,145,0.08) 42%, transparent 72%)",
						filter: "blur(42px)",
					}}
				/>
				<div className="relative">
					<div className="rounded-2xl border border-white/15 bg-white/[0.025] p-2 shadow-[0_24px_90px_rgba(0,0,0,0.55)]">
						<ProductFrame />
					</div>
				</div>
			</div>
		</section>
	);
}
