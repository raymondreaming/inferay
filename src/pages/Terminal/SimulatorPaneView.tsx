import * as stylex from "@stylexjs/stylex";
import {
	type PointerEvent as ReactPointerEvent,
	type WheelEvent as ReactWheelEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "../../components/ui/Button.tsx";
import { DropdownButton } from "../../components/ui/DropdownButton.tsx";
import {
	IconIPad,
	IconIPadAir,
	IconIPadMini,
	IconIPadPro,
	IconIPhone,
	IconIPhoneAir,
	IconIPhonePro,
	IconIPhoneProMax,
	IconLoader,
	IconReactNative,
	IconSearch,
	IconSimulator,
	IconSwift,
} from "../../components/ui/Icons.tsx";
import { isBootedSimulatorDevice } from "../../features/simulator/simulator-utils.ts";
import type {
	BaguetteStatus,
	SimulatorDevice,
	SimulatorProject,
} from "../../features/simulator/types.ts";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import { hasId, hasUdid, noop, toggleBoolean } from "../../lib/data.ts";
import {
	readStoredJson,
	readStoredValue,
	removeStoredValue,
	writeStoredJson,
	writeStoredValue,
} from "../../lib/stored-json.ts";
import { color, controlSize, font, radius } from "../../tokens.stylex.ts";

interface SimulatorSnapshot {
	devices: SimulatorDevice[];
	projects: SimulatorProject[];
	status: BaguetteStatus | null;
	error?: string;
}

async function loadSimulatorSnapshot(): Promise<SimulatorSnapshot> {
	const [listRes, statusRes, projectsRes] = await Promise.all([
		fetch("/api/simulator/list"),
		fetch("/api/simulator/baguette/status"),
		fetch("/api/simulator/projects"),
	]);
	const listJson = await listRes.json();
	const statusJson = statusRes.ok
		? ((await statusRes.json()) as BaguetteStatus)
		: null;
	const projectsJson = await projectsRes.json();
	const error =
		(!listRes.ok && typeof listJson.error === "string"
			? listJson.error
			: null) ??
		(!projectsRes.ok && typeof projectsJson.error === "string"
			? projectsJson.error
			: null) ??
		undefined;
	return {
		devices: listRes.ok ? ((listJson.devices ?? []) as SimulatorDevice[]) : [],
		projects: projectsRes.ok
			? ((projectsJson.projects ?? []) as SimulatorProject[])
			: [],
		status: statusJson,
		error,
	};
}

type LaunchPhase = "booting" | "building" | "launching";
type FarmLayout = "grid" | "wall" | "list";
type FarmPlatform = "iphone" | "ipad";
type FarmState = "live" | "boot" | "off";
type StreamProfile = "thumb" | "full";

interface BaguettePoint {
	x: number;
	y: number;
	width: number;
	height: number;
}

const SIMULATOR_LAUNCHED_PROJECT_KEY = "inferay.simulator.launchedProjectId";
const SIMULATOR_DEVICE_PROJECTS_KEY = "inferay.simulator.deviceProjectIds";

function projectKindLabel(kind: SimulatorProject["kind"]) {
	return kind === "react-native" ? "React Native" : "Swift";
}

function ProjectKindIcon({
	kind,
	size = 11,
}: {
	kind: SimulatorProject["kind"];
	size?: number;
}) {
	return kind === "react-native" ? (
		<IconReactNative size={size} />
	) : (
		<IconSwift size={size} />
	);
}

function DeviceKindIcon({ name, size = 13 }: { name: string; size?: number }) {
	const normalized = name.toLowerCase();
	if (normalized.includes("ipad pro")) return <IconIPadPro size={size} />;
	if (normalized.includes("ipad air")) return <IconIPadAir size={size} />;
	if (normalized.includes("ipad mini")) return <IconIPadMini size={size} />;
	if (normalized.includes("ipad")) return <IconIPad size={size} />;
	if (normalized.includes("pro max")) return <IconIPhoneProMax size={size} />;
	if (normalized.includes("pro")) return <IconIPhonePro size={size} />;
	if (normalized.includes("air")) return <IconIPhoneAir size={size} />;
	return <IconIPhone size={size} />;
}

function toggleSet<T>(value: T) {
	return (current: Set<T>) => {
		const next = new Set(current);
		next.has(value) ? next.delete(value) : next.add(value);
		return next;
	};
}

function platformForDevice(name: string): FarmPlatform {
	return name.toLowerCase().includes("ipad") ? "ipad" : "iphone";
}

function stateForDevice(state: string): FarmState {
	if (state === "Booted") return "live";
	if (state === "Booting" || state === "Shutting Down") return "boot";
	return "off";
}

function farmStateLabel(state: FarmState) {
	if (state === "live") return "Live";
	if (state === "boot") return "Booting";
	return "Shutdown";
}

function launchPhaseLabel(phase: LaunchPhase) {
	if (phase === "booting") return "Booting simulator";
	if (phase === "launching") return "Opening app";
	return "Building";
}

type StreamState = "idle" | "connecting" | "live" | "disconnected";

function BaguetteStream({
	baseUrl,
	udid,
	onStateChange,
	interactive = true,
	profile = "full",
}: {
	baseUrl: string;
	udid: string;
	onStateChange: (state: StreamState) => void;
	interactive?: boolean;
	profile?: StreamProfile;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const frameSizeRef = useRef({ width: 0, height: 0 });
	const pointerRef = useRef<{
		startX: number;
		startY: number;
		dragging: boolean;
	} | null>(null);

	const sendWire = useCallback((payload: object) => {
		const ws = wsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify(payload));
	}, []);

	const pointForEvent = useCallback(
		(event: ReactPointerEvent | ReactWheelEvent) => {
			const canvas = canvasRef.current;
			const size = frameSizeRef.current;
			if (!canvas || !size.width || !size.height) return null;
			const rect = canvas.getBoundingClientRect();
			return {
				x: Math.max(
					0,
					Math.min(
						size.width,
						((event.clientX - rect.left) / rect.width) * size.width
					)
				),
				y: Math.max(
					0,
					Math.min(
						size.height,
						((event.clientY - rect.top) / rect.height) * size.height
					)
				),
				width: size.width,
				height: size.height,
			};
		},
		[]
	);

	const sendTouch2 = useCallback(
		(phase: "down" | "move" | "up", point: BaguettePoint) => {
			sendWire({
				type: `touch2-${phase}`,
				x1: point.x,
				y1: point.y,
				x2: point.x,
				y2: point.y,
				width: point.width,
				height: point.height,
			});
		},
		[sendWire]
	);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		onStateChange("connecting");
		canvas.width = 0;
		canvas.height = 0;
		frameSizeRef.current = { width: 0, height: 0 };
		pointerRef.current = null;
		const wsBase = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
		const socket = new WebSocket(
			`${wsBase}/simulators/${encodeURIComponent(udid)}/stream?format=mjpeg&version=v2`
		);
		socket.binaryType = "arraybuffer";
		wsRef.current = socket;
		let alive = true;
		let pending: ImageBitmap | null = null;
		let raf = 0;
		const ctx = canvas.getContext("2d");
		const clearCanvas = () => {
			if (pending) {
				pending.close();
				pending = null;
			}
			canvas.width = 0;
			canvas.height = 0;
			frameSizeRef.current = { width: 0, height: 0 };
			pointerRef.current = null;
		};

		const paint = () => {
			if (!alive) return;
			if (pending && ctx) {
				const frame = pending;
				pending = null;
				if (canvas.width !== frame.width || canvas.height !== frame.height) {
					canvas.width = frame.width;
					canvas.height = frame.height;
					frameSizeRef.current = { width: frame.width, height: frame.height };
				}
				ctx.drawImage(frame, 0, 0);
				frame.close();
			}
			raf = requestAnimationFrame(paint);
		};

		socket.onopen = () => {
			const config =
				profile === "thumb"
					? { fps: 8, scale: 4, bps: 600_000 }
					: { fps: 60, scale: 1, bps: 6_000_000 };
			socket.send(JSON.stringify({ type: "set_fps", fps: config.fps }));
			socket.send(JSON.stringify({ type: "set_scale", scale: config.scale }));
			socket.send(JSON.stringify({ type: "set_bitrate", bps: config.bps }));
			onStateChange("live");
		};
		socket.onerror = () => {
			clearCanvas();
			onStateChange("disconnected");
		};
		socket.onclose = () => {
			clearCanvas();
			onStateChange("disconnected");
		};
		socket.onmessage = async (event) => {
			if (!(event.data instanceof ArrayBuffer)) return;
			try {
				const bitmap = await createImageBitmap(
					new Blob([event.data], { type: "image/jpeg" })
				);
				if (pending) pending.close();
				pending = bitmap;
			} catch {}
		};
		raf = requestAnimationFrame(paint);

		return () => {
			alive = false;
			cancelAnimationFrame(raf);
			clearCanvas();
			if (wsRef.current === socket) wsRef.current = null;
			socket.close();
		};
	}, [baseUrl, onStateChange, profile, udid]);

	const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const point = pointForEvent(event);
		if (!point) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		pointerRef.current = {
			startX: point.x,
			startY: point.y,
			dragging: false,
		};
	};

	const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const state = pointerRef.current;
		const point = pointForEvent(event);
		if (!state || !point) return;
		const distance = Math.hypot(point.x - state.startX, point.y - state.startY);
		if (!state.dragging && distance > 8) {
			state.dragging = true;
			sendTouch2("down", {
				x: state.startX,
				y: state.startY,
				width: point.width,
				height: point.height,
			});
		}
		if (state.dragging) sendTouch2("move", point);
	};

	const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const state = pointerRef.current;
		const point = pointForEvent(event);
		if (!state || !point) return;
		if (state.dragging) {
			sendTouch2("up", point);
		} else {
			sendWire({
				type: "tap",
				x: state.startX,
				y: state.startY,
				width: point.width,
				height: point.height,
				duration: 0.05,
			});
		}
		pointerRef.current = null;
	};

	const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const point = pointForEvent(event);
		if (!point) return;
		const spread = 80;
		const dy = Math.max(-160, Math.min(160, -event.deltaY));
		const base = { width: point.width, height: point.height };
		const payload = {
			x1: point.x + spread,
			y1: point.y + dy,
			x2: point.x - spread,
			y2: point.y + dy,
			...base,
		};
		sendWire({ type: "touch2-down", ...payload });
		sendWire({ type: "touch2-move", ...payload });
		window.setTimeout(() => sendWire({ type: "touch2-up", ...payload }), 80);
	};

	return (
		<canvas
			ref={canvasRef}
			aria-label="Live simulator"
			{...stylex.props(styles.canvas)}
			onPointerDown={interactive ? handlePointerDown : undefined}
			onPointerMove={interactive ? handlePointerMove : undefined}
			onPointerUp={interactive ? finishPointer : undefined}
			onPointerCancel={interactive ? finishPointer : undefined}
			onWheel={interactive ? handleWheel : undefined}
		/>
	);
}

function FarmEmptyState() {
	return (
		<div {...stylex.props(styles.farmEmptyState)}>
			<IconSimulator size={22} />
			<span>No devices match these filters.</span>
		</div>
	);
}

function FilterPills<T extends string>({
	items,
	selected,
	onToggle,
	label,
	count,
}: {
	items: readonly T[];
	selected: Set<T>;
	onToggle: (item: T) => void;
	label: (item: T) => string;
	count: (item: T) => number;
}) {
	return (
		<div {...stylex.props(styles.farmHeaderFilterGroup)}>
			{items.map((item) => (
				<Button
					key={item}
					type="button"
					size="sm"
					variant={selected.has(item) ? "secondary" : "ghost"}
					onClick={() => onToggle(item)}
				>
					{label(item)}
					<span {...stylex.props(styles.sidebarSwitchCount)}>
						{count(item)}
					</span>
				</Button>
			))}
		</div>
	);
}

function FarmTile({
	device,
	baseUrl,
	active,
	streaming,
	appName,
	onFocus,
	onKill,
	onBoot,
}: {
	device: SimulatorDevice;
	baseUrl: string;
	active: boolean;
	streaming: boolean;
	appName?: string | null;
	onFocus: () => void;
	onKill: () => void;
	onBoot: () => void;
}) {
	const [state, setState] = useState<StreamState>("idle");
	const booted = isBootedSimulatorDevice(device);
	const deviceState = stateForDevice(device.state);
	const live = booted && streaming && state === "live";
	return (
		<div
			{...stylex.props(
				styles.farmTile,
				deviceState === "live" && styles.farmTileLive,
				active && styles.farmTileActive
			)}
		>
			<button
				type="button"
				{...stylex.props(styles.farmPreview)}
				onClick={onFocus}
			>
				<span
					{...stylex.props(
						styles.farmStatusBadge,
						deviceState === "live" && styles.farmStatusBadgeLive,
						deviceState === "boot" && styles.farmStatusBadgeBoot
					)}
				>
					<span {...stylex.props(styles.farmStatusDot)} />
					{farmStateLabel(deviceState)}
				</span>
				{booted && streaming ? (
					<BaguetteStream
						baseUrl={baseUrl}
						udid={device.udid}
						onStateChange={setState}
						interactive={false}
						profile="thumb"
					/>
				) : (
					<div {...stylex.props(styles.farmDevicePlaceholder)}>
						<DeviceKindIcon name={device.name} size={34} />
					</div>
				)}
				{!live ? (
					<div {...stylex.props(styles.farmTileOverlay)}>
						{booted && streaming
							? state === "connecting"
								? "Connecting"
								: "Stream idle"
							: booted
								? "Preview off"
								: "Boot to stream"}
					</div>
				) : null}
			</button>
			<div {...stylex.props(styles.farmTileBar)}>
				<span {...stylex.props(styles.deviceIcon)}>
					<DeviceKindIcon name={device.name} size={12} />
				</span>
				<span {...stylex.props(styles.farmTileText)}>
					<span {...stylex.props(styles.deviceName)}>{device.name}</span>
					<span {...stylex.props(styles.deviceMeta)}>
						{appName ? `${appName} · ${device.runtime}` : device.runtime}
					</span>
				</span>
				<button
					type="button"
					{...stylex.props(styles.miniPrimaryButton, styles.deviceKillButton)}
					onClick={booted ? onKill : onBoot}
				>
					{booted ? "Kill" : "Boot"}
				</button>
			</div>
		</div>
	);
}

export function SimulatorPaneView() {
	const { data: simulatorSnapshot, refresh } =
		useAsyncResource<SimulatorSnapshot>(
			loadSimulatorSnapshot,
			{ devices: [], projects: [], status: null },
			[]
		);
	const {
		devices,
		projects,
		status,
		error: simulatorError,
	} = simulatorSnapshot;
	const [selectedUdid, setSelectedUdid] = useState<string | null>(null);
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
		null
	);
	const [launchProgress, setLaunchProgress] = useState<{
		projectId: string;
		udid: string;
		phase: LaunchPhase;
	} | null>(null);
	const [launchError, setLaunchError] = useState<string | null>(null);
	const [launchedProjectId, setLaunchedProjectId] = useState<string | null>(
		() => readStoredValue(SIMULATOR_LAUNCHED_PROJECT_KEY)
	);
	const [deviceProjectIds, setDeviceProjectIds] = useState<
		Record<string, string>
	>(() =>
		readStoredJson<Record<string, string>>(SIMULATOR_DEVICE_PROJECTS_KEY, {})
	);
	const [projectSearch, setProjectSearch] = useState("");
	const [streamState, setStreamState] = useState<StreamState>("idle");
	const [viewMode, setViewMode] = useState<"focus" | "farm">("focus");
	const [farmLayout, setFarmLayout] = useState<FarmLayout>("grid");
	const [farmPreviewStreams, setFarmPreviewStreams] = useState(false);
	const [farmPlatforms, setFarmPlatforms] = useState<Set<FarmPlatform>>(
		() => new Set(["iphone", "ipad"])
	);
	const [farmStates, setFarmStates] = useState<Set<FarmState>>(
		() => new Set(["live", "boot", "off"])
	);
	const selectedDevice = useMemo(
		() => devices.find(hasUdid.bind(null, selectedUdid)) ?? devices[0],
		[devices, selectedUdid]
	);
	const viewportDevice = useMemo(
		() =>
			selectedDevice?.state === "Booted"
				? selectedDevice
				: (devices.find(isBootedSimulatorDevice) ?? selectedDevice),
		[devices, selectedDevice]
	);
	const selectedProject = useMemo(
		() => projects.find(hasId.bind(null, selectedProjectId)) ?? projects[0],
		[projects, selectedProjectId]
	);
	const launchedProject = useMemo(
		() => projects.find(hasId.bind(null, launchedProjectId)) ?? null,
		[launchedProjectId, projects]
	);
	const projectById = useMemo(
		() => new Map(projects.map((project) => [project.id, project])),
		[projects]
	);
	const selectedDeviceProject = selectedDevice
		? (projectById.get(deviceProjectIds[selectedDevice.udid] ?? "") ?? null)
		: null;
	const projectNameForDevice = useCallback(
		(device: SimulatorDevice) =>
			projectById.get(deviceProjectIds[device.udid] ?? "")?.name ?? null,
		[deviceProjectIds, projectById]
	);
	const filteredProjects = useMemo(() => {
		const query = projectSearch.trim().toLowerCase();
		if (!query) return projects;
		return projects.filter((project) =>
			[
				project.name,
				project.path,
				project.bundleId ?? "",
				project.kind === "react-native" ? "react native" : "xcode",
			]
				.join(" ")
				.toLowerCase()
				.includes(query)
		);
	}, [projectSearch, projects]);
	const selectedLaunchDevice = useMemo(
		() => devices.find(hasUdid.bind(null, selectedUdid)) ?? null,
		[devices, selectedUdid]
	);
	const farmCounts = useMemo(() => {
		const platforms: Record<FarmPlatform, number> = { iphone: 0, ipad: 0 };
		const states: Record<FarmState, number> = { live: 0, boot: 0, off: 0 };
		for (const device of devices) {
			platforms[platformForDevice(device.name)] += 1;
			states[stateForDevice(device.state)] += 1;
		}
		return { platforms, states };
	}, [devices]);
	const filteredFarmDevices = useMemo(() => {
		return devices.filter((device) => {
			const platform = platformForDevice(device.name);
			const state = stateForDevice(device.state);
			if (!farmPlatforms.has(platform) || !farmStates.has(state)) return false;
			return true;
		});
	}, [devices, farmPlatforms, farmStates]);

	const shutdownSelectedSimulator = useCallback(
		async (device?: SimulatorDevice) => {
			const target = device ?? viewportDevice ?? selectedDevice;
			if (!target?.udid) return;
			await fetch("/api/simulator/shutdown", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ udid: target.udid }),
			}).catch(noop);
			if (target.udid === viewportDevice?.udid) {
				setLaunchedProjectId(null);
				removeStoredValue(SIMULATOR_LAUNCHED_PROJECT_KEY);
			}
			await refresh();
		},
		[refresh, selectedDevice, viewportDevice]
	);

	const bootSelectedSimulator = useCallback(
		async (device?: SimulatorDevice) => {
			const target = device ?? selectedLaunchDevice ?? selectedDevice;
			if (!target?.udid) return;
			setSelectedUdid(target.udid);
			await fetch("/api/simulator/boot", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ udid: target.udid }),
			}).catch(noop);
			await refresh();
		},
		[refresh, selectedDevice, selectedLaunchDevice]
	);

	const toggleFarmPlatform = useCallback(
		(platform: FarmPlatform) => setFarmPlatforms(toggleSet(platform)),
		[]
	);

	const toggleFarmState = useCallback(
		(state: FarmState) => setFarmStates(toggleSet(state)),
		[]
	);

	const buildLaunchProject = useCallback(
		async (project: SimulatorProject) => {
			const targetDevice = selectedLaunchDevice ?? selectedDevice;
			if (!targetDevice?.udid) return;
			setSelectedUdid(targetDevice.udid);
			setLaunchError(null);
			try {
				if (targetDevice.state !== "Booted") {
					setLaunchProgress({
						projectId: project.id,
						udid: targetDevice.udid,
						phase: "booting",
					});
					await fetch("/api/simulator/boot", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ udid: targetDevice.udid }),
					});
				}
				setLaunchProgress({
					projectId: project.id,
					udid: targetDevice.udid,
					phase: "building",
				});
				const res = await fetch("/api/simulator/build-launch", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						udid: targetDevice.udid,
						appPath: project.path,
						scheme: project.defaultScheme,
					}),
				});
				setLaunchProgress({
					projectId: project.id,
					udid: targetDevice.udid,
					phase: "launching",
				});
				const data = await res.json();
				if (!res.ok || data.error) {
					setLaunchError(data.error || "Launch failed");
					return;
				}
				setLaunchedProjectId(project.id);
				writeStoredValue(SIMULATOR_LAUNCHED_PROJECT_KEY, project.id);
				setDeviceProjectIds((current) => {
					const next = { ...current, [targetDevice.udid]: project.id };
					writeStoredJson(SIMULATOR_DEVICE_PROJECTS_KEY, next);
					return next;
				});
				await refresh();
			} finally {
				setLaunchProgress(null);
			}
		},
		[refresh, selectedDevice, selectedLaunchDevice]
	);

	const canStream =
		!!status?.running &&
		!!viewportDevice?.udid &&
		viewportDevice.state === "Booted";
	const streamIsLive = canStream && streamState === "live";

	useEffect(() => {
		if (!canStream) setStreamState("idle");
	}, [canStream]);

	return (
		<div {...stylex.props(styles.root)}>
			<div {...stylex.props(styles.body)}>
				<div {...stylex.props(styles.sideRail)}>
					<div {...stylex.props(styles.projectSection)}>
						<div {...stylex.props(styles.railHeading)}>PROJECTS</div>
						<div {...stylex.props(styles.launchTarget)}>
							<DropdownButton
								value={selectedLaunchDevice?.udid ?? null}
								options={devices.map((device) => ({
									id: device.udid,
									label: device.name,
									detail: device.runtime,
									status: projectNameForDevice(device) ?? undefined,
									icon: <DeviceKindIcon name={device.name} size={12} />,
								}))}
								onChange={(id) => setSelectedUdid(id)}
								placeholder="Select simulator"
								emptyLabel={
									simulatorError
										? "Simulator service unavailable"
										: "No simulators"
								}
								fullWidth
								minWidth={260}
								buttonClassName={
									stylex.props(styles.launchTargetDropdown).className
								}
								labelClassName={
									stylex.props(styles.launchTargetDropdownLabel).className
								}
								renderOption={(opt, isSelected) => (
									<div
										{...stylex.props(
											styles.launchDeviceOption,
											isSelected && styles.launchDeviceOptionSelected
										)}
									>
										<span {...stylex.props(styles.deviceIcon)}>{opt.icon}</span>
										<span {...stylex.props(styles.launchDeviceText)}>
											<span {...stylex.props(styles.deviceName)}>
												{opt.label}
											</span>
											<span {...stylex.props(styles.deviceMeta)}>
												{opt.status
													? `${opt.status} · ${opt.detail ?? ""}`
													: opt.detail}
											</span>
										</span>
									</div>
								)}
							/>
						</div>
						{launchError ? (
							<div {...stylex.props(styles.launchError)}>{launchError}</div>
						) : simulatorError ? (
							<div {...stylex.props(styles.launchError)}>{simulatorError}</div>
						) : null}
						<div {...stylex.props(styles.projectSearchWrap)}>
							<IconSearch size={12} />
							<input
								type="search"
								value={projectSearch}
								onChange={(event) => setProjectSearch(event.target.value)}
								placeholder="Search projects"
								{...stylex.props(styles.projectSearchInput)}
							/>
						</div>
						{projects.length === 0 ? (
							<div {...stylex.props(styles.emptyText)}>
								No simulator projects found. Configure Xcode projects in
								Profile.
							</div>
						) : filteredProjects.length === 0 ? (
							<div {...stylex.props(styles.emptyText)}>
								No projects match this search.
							</div>
						) : (
							<div {...stylex.props(styles.projectList)}>
								{filteredProjects.map((project) => {
									const active = project.id === selectedProject?.id;
									const progress =
										launchProgress?.projectId === project.id
											? launchProgress
											: null;
									const busy = !!progress;
									return (
										<div
											key={project.id}
											{...stylex.props(
												styles.projectCard,
												active && styles.deviceButtonActive
											)}
										>
											<button
												type="button"
												{...stylex.props(styles.projectMain)}
												onClick={() => setSelectedProjectId(project.id)}
											>
												<span {...stylex.props(styles.projectText)}>
													<span {...stylex.props(styles.projectTitleRow)}>
														<span
															{...stylex.props(styles.projectKind)}
															title={projectKindLabel(project.kind)}
														>
															<ProjectKindIcon kind={project.kind} />
														</span>
														<span {...stylex.props(styles.deviceName)}>
															{project.name}
														</span>
													</span>
													{progress || project.running || project.installed ? (
														<span {...stylex.props(styles.projectStatus)}>
															{progress
																? `${launchPhaseLabel(progress.phase)} on ${
																		devices.find(
																			hasUdid.bind(null, progress.udid)
																		)?.name ?? "selected simulator"
																	}`
																: project.running
																	? "Running"
																	: "Installed"}
														</span>
													) : null}
												</span>
											</button>
											<div {...stylex.props(styles.projectActions)}>
												<button
													type="button"
													{...stylex.props(styles.miniPrimaryButton)}
													onClick={() => buildLaunchProject(project)}
													disabled={busy || !selectedLaunchDevice}
												>
													{progress
														? launchPhaseLabel(progress.phase)
														: "Launch"}
												</button>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</div>
				</div>
				<div {...stylex.props(styles.viewport)}>
					<div {...stylex.props(styles.simulatorStage)}>
						<div {...stylex.props(styles.viewportContextBar)}>
							<div {...stylex.props(styles.viewportIdentity)}>
								<span {...stylex.props(styles.viewportIcon)}>
									<IconSimulator size={12} />
								</span>
								<span {...stylex.props(styles.viewportText)}>
									<span {...stylex.props(styles.viewportTitle)}>
										{selectedDeviceProject?.name ??
											launchedProject?.name ??
											"No app launched"}
									</span>
									<span {...stylex.props(styles.viewportMeta)}>
										{selectedDevice
											? `${viewportDevice?.name ?? selectedDevice.name} · ${
													viewportDevice?.runtime ?? selectedDevice.runtime
												}`
											: "No simulator selected"}
									</span>
								</span>
							</div>
							<div {...stylex.props(styles.viewportBadges)}>
								<div {...stylex.props(styles.viewToggle)}>
									<button
										type="button"
										{...stylex.props(
											styles.viewToggleButton,
											viewMode === "focus" && styles.viewToggleButtonActive
										)}
										onClick={() => setViewMode("focus")}
									>
										Focus
									</button>
									<button
										type="button"
										{...stylex.props(
											styles.viewToggleButton,
											viewMode === "farm" && styles.viewToggleButtonActive
										)}
										onClick={() => setViewMode("farm")}
									>
										Farm
									</button>
								</div>
								{selectedDeviceProject || launchedProject ? (
									<>
										<span {...stylex.props(styles.viewportBadge)}>
											<ProjectKindIcon
												kind={
													(selectedDeviceProject ?? launchedProject)?.kind ??
													"xcode"
												}
											/>
											{projectKindLabel(
												(selectedDeviceProject ?? launchedProject)?.kind ??
													"xcode"
											)}
										</span>
										<span {...stylex.props(styles.viewportBadge)}>
											Launched
										</span>
									</>
								) : null}
								<span
									{...stylex.props(
										styles.viewportBadge,
										streamIsLive && styles.viewportBadgeLive
									)}
								>
									{streamIsLive
										? "Live"
										: canStream && streamState === "connecting"
											? "Connecting"
											: "Stream idle"}
								</span>
							</div>
						</div>
						<div {...stylex.props(styles.simulatorSurface)}>
							{viewMode === "farm" ? (
								devices.length > 0 ? (
									<div {...stylex.props(styles.farmWorkspace)}>
										<section {...stylex.props(styles.farmFleet)}>
											<div {...stylex.props(styles.farmFleetHead)}>
												<div {...stylex.props(styles.farmHeaderFilters)}>
													<FilterPills
														items={["iphone", "ipad"] as const}
														selected={farmPlatforms}
														onToggle={toggleFarmPlatform}
														label={(p) => (p === "ipad" ? "iPad" : "iPhone")}
														count={(p) => farmCounts.platforms[p]}
													/>
													<FilterPills
														items={["live", "boot", "off"] as const}
														selected={farmStates}
														onToggle={toggleFarmState}
														label={farmStateLabel}
														count={(s) => farmCounts.states[s]}
													/>
												</div>
												<div {...stylex.props(styles.farmTools)}>
													<Button
														type="button"
														size="sm"
														variant={farmPreviewStreams ? "secondary" : "ghost"}
														onClick={setFarmPreviewStreams.bind(
															null,
															toggleBoolean
														)}
													>
														Previews {farmPreviewStreams ? "On" : "Off"}
													</Button>
													<div {...stylex.props(styles.viewToggle)}>
														{(["grid", "wall", "list"] as FarmLayout[]).map(
															(layout) => (
																<button
																	key={layout}
																	type="button"
																	{...stylex.props(
																		styles.viewToggleButton,
																		farmLayout === layout &&
																			styles.viewToggleButtonActive
																	)}
																	onClick={() => setFarmLayout(layout)}
																>
																	{layout}
																</button>
															)
														)}
													</div>
												</div>
											</div>
											{farmLayout === "list" ? (
												<div {...stylex.props(styles.farmList)}>
													{filteredFarmDevices.length === 0 ? (
														<FarmEmptyState />
													) : (
														filteredFarmDevices.map((device) => {
															const deviceState = stateForDevice(device.state);
															const appName = projectNameForDevice(device);
															return (
																<button
																	key={device.udid}
																	type="button"
																	{...stylex.props(
																		styles.farmListRow,
																		device.udid === selectedDevice?.udid &&
																			styles.farmListRowActive
																	)}
																	onClick={setSelectedUdid.bind(
																		null,
																		device.udid
																	)}
																>
																	<span
																		{...stylex.props(
																			styles.farmStateDot,
																			deviceState === "live" &&
																				styles.farmStateDotLive,
																			deviceState === "boot" &&
																				styles.farmStateDotBoot
																		)}
																	/>
																	<span {...stylex.props(styles.deviceName)}>
																		{device.name}
																	</span>
																	<span {...stylex.props(styles.deviceMeta)}>
																		{appName
																			? `${appName} · ${device.runtime}`
																			: device.runtime}
																	</span>
																	<span
																		{...stylex.props(styles.farmListStatus)}
																	>
																		{farmStateLabel(deviceState)}
																	</span>
																</button>
															);
														})
													)}
												</div>
											) : (
												<div
													{...stylex.props(
														styles.farmGrid,
														farmLayout === "wall" && styles.farmWall
													)}
												>
													{filteredFarmDevices.length === 0 ? (
														<FarmEmptyState />
													) : (
														filteredFarmDevices.map((device) => (
															<FarmTile
																key={device.udid}
																device={device}
																baseUrl={status?.baseUrl ?? ""}
																streaming={
																	!!status?.running && farmPreviewStreams
																}
																appName={projectNameForDevice(device)}
																active={device.udid === selectedDevice?.udid}
																onFocus={setSelectedUdid.bind(
																	null,
																	device.udid
																)}
																onKill={shutdownSelectedSimulator.bind(
																	null,
																	device
																)}
																onBoot={bootSelectedSimulator.bind(
																	null,
																	device
																)}
															/>
														))
													)}
												</div>
											)}
										</section>
										<aside {...stylex.props(styles.farmFocusPane)}>
											<div {...stylex.props(styles.farmPanelHeader)}>
												<span>Focused Device</span>
												<span {...stylex.props(styles.farmPanelCount)}>
													{selectedDevice
														? farmStateLabel(
																stateForDevice(selectedDevice.state)
															)
														: ""}
												</span>
											</div>
											{selectedDevice ? (
												<>
													<div {...stylex.props(styles.farmFocusPreview)}>
														{selectedDevice.state === "Booted" &&
														status?.running ? (
															<BaguetteStream
																key={`farm-focus-${selectedDevice.udid}`}
																baseUrl={status.baseUrl}
																udid={selectedDevice.udid}
																onStateChange={setStreamState}
																profile="full"
															/>
														) : (
															<div
																{...stylex.props(styles.farmDevicePlaceholder)}
															>
																<DeviceKindIcon
																	name={selectedDevice.name}
																	size={42}
																/>
															</div>
														)}
													</div>
													<div {...stylex.props(styles.farmFocusInfo)}>
														<div {...stylex.props(styles.viewportTitle)}>
															{selectedDevice.name}
														</div>
														<div {...stylex.props(styles.viewportMeta)}>
															{selectedDeviceProject
																? `${selectedDeviceProject.name} · ${selectedDevice.runtime}`
																: selectedDevice.runtime}
														</div>
														<div {...stylex.props(styles.farmFocusActions)}>
															<button
																type="button"
																{...stylex.props(
																	styles.miniPrimaryButton,
																	styles.deviceKillButton
																)}
																onClick={() =>
																	void bootSelectedSimulator(selectedDevice)
																}
																disabled={selectedDevice.state === "Booted"}
															>
																Boot
															</button>
															<button
																type="button"
																{...stylex.props(
																	styles.miniPrimaryButton,
																	styles.deviceKillButton
																)}
																onClick={() =>
																	void shutdownSelectedSimulator(selectedDevice)
																}
																disabled={selectedDevice.state !== "Booted"}
															>
																Kill
															</button>
														</div>
													</div>
												</>
											) : (
												<div {...stylex.props(styles.emptyText)}>
													Select a simulator.
												</div>
											)}
										</aside>
									</div>
								) : (
									<div {...stylex.props(styles.streamEmpty)}>
										<IconSimulator size={24} />
										<span>
											{simulatorError ??
												"No simulator devices found. Open Simulator or install an iOS simulator runtime in Xcode."}
										</span>
									</div>
								)
							) : canStream ? (
								<BaguetteStream
									key={viewportDevice.udid}
									baseUrl={status.baseUrl}
									udid={viewportDevice.udid}
									onStateChange={setStreamState}
								/>
							) : (
								<div {...stylex.props(styles.streamEmpty)}>
									<IconSimulator size={24} />
									<span>
										{status?.installed === false
											? "Install Baguette with brew install tddworks/tap/baguette"
											: launchedProject
												? `Start the stream to interact with ${launchedProject.name}.`
												: "Launch an app to bind this simulator view."}
									</span>
								</div>
							)}
							{viewMode === "focus" && canStream && !streamIsLive ? (
								<div {...stylex.props(styles.streamOverlay)}>
									<IconLoader size={13} />
									<span>
										{streamState === "disconnected"
											? "Stream disconnected. Refresh or restart the stream."
											: "Connecting to simulator stream..."}
									</span>
								</div>
							) : null}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

const styles = stylex.create({
	root: {
		display: "flex",
		minHeight: 0,
		height: "100%",
		flexDirection: "column",
		backgroundColor: color.background,
		color: color.textMain,
	},
	body: {
		display: "flex",
		minHeight: 0,
		flex: 1,
	},
	sideRail: {
		display: "flex",
		flexDirection: "column",
		width: "19rem",
		minWidth: "15.5rem",
		overflow: "hidden",
		borderRightWidth: 1,
		borderRightStyle: "solid",
		borderRightColor: color.border,
		backgroundColor: color.background,
		padding: controlSize._1_5,
	},
	sidebarSwitchCount: {
		color: color.textFaint,
		fontSize: font.size_1,
		marginInlineStart: controlSize._1,
	},
	projectSection: {
		display: "flex",
		minHeight: 0,
		flex: 1,
		flexDirection: "column",
		gap: "0.1875rem",
	},
	projectList: {
		display: "flex",
		minHeight: 0,
		flex: 1,
		flexDirection: "column",
		gap: "0.1875rem",
		overflowY: "auto",
	},
	launchTarget: {
		display: "flex",
		minHeight: controlSize._8,
		alignItems: "center",
		gap: controlSize._2,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.backgroundRaised,
		color: color.textMuted,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	launchTargetDropdown: {
		minWidth: 0,
		flex: 1,
		height: controlSize._7,
		borderWidth: 0,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		paddingInline: controlSize._1,
	},
	launchTargetDropdownLabel: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	launchDeviceOption: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		minHeight: controlSize._9,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	launchDeviceOptionSelected: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	launchDeviceText: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		flexDirection: "column",
		gap: "0.0625rem",
	},
	launchError: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.backgroundRaised,
		color: color.textSoft,
		fontSize: font.size_1,
		lineHeight: 1.35,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	railHeading: {
		color: color.textFaint,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	projectSearchWrap: {
		display: "flex",
		height: controlSize._7,
		alignItems: "center",
		gap: controlSize._2,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.background,
		color: color.textMuted,
		paddingInline: controlSize._2,
	},
	projectSearchInput: {
		minWidth: 0,
		flex: 1,
		borderWidth: 0,
		outlineWidth: 0,
		backgroundColor: color.transparent,
		color: color.textMain,
		fontSize: font.size_2,
		"::placeholder": {
			color: color.textFaint,
		},
	},
	projectCard: {
		display: "flex",
		minHeight: "2.25rem",
		alignItems: "center",
		gap: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.transparent,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		overflow: "hidden",
	},
	projectMain: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		alignItems: "center",
		backgroundColor: color.transparent,
		color: "inherit",
		paddingBlock: "0.1875rem",
		paddingInline: controlSize._2,
		textAlign: "left",
	},
	projectText: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		flexDirection: "column",
		gap: "0.0625rem",
	},
	projectTitleRow: {
		display: "flex",
		minWidth: 0,
		alignItems: "center",
		gap: controlSize._1,
	},
	projectKind: {
		display: "inline-flex",
		width: controlSize._6,
		height: controlSize._6,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.backgroundRaised,
		color: color.textFaint,
	},
	projectStatus: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
	},
	projectActions: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1,
		paddingInlineEnd: controlSize._1,
	},
	miniPrimaryButton: {
		height: controlSize._6,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		paddingInline: controlSize._2,
		":disabled": {
			opacity: 0.45,
		},
	},
	deviceButtonActive: {
		borderColor: color.accentBorder,
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	deviceKillButton: {
		flexShrink: 0,
	},
	deviceIcon: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.backgroundRaised,
		color: color.textFaint,
	},
	deviceName: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	deviceMeta: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: font.size_1,
		color: color.textMuted,
	},
	viewport: {
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flex: 1,
		alignItems: "stretch",
		justifyContent: "stretch",
		overflow: "hidden",
		padding: controlSize._3,
	},
	simulatorStage: {
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flex: 1,
		flexDirection: "column",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundColor: color.background,
	},
	viewportContextBar: {
		display: "flex",
		minHeight: controlSize._9,
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._3,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.backgroundRaised,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	viewportIdentity: {
		display: "flex",
		minWidth: 0,
		alignItems: "center",
		gap: controlSize._2,
	},
	viewportIcon: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.controlActive,
		color: color.textSoft,
	},
	viewportText: {
		display: "flex",
		minWidth: 0,
		flexDirection: "column",
		gap: "0.0625rem",
	},
	viewportTitle: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
	},
	viewportMeta: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
	},
	viewportBadges: {
		display: "flex",
		minWidth: 0,
		flexShrink: 1,
		alignItems: "center",
		justifyContent: "flex-end",
		gap: controlSize._1,
	},
	viewToggle: {
		display: "inline-flex",
		alignItems: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.background,
		padding: "0.125rem",
	},
	viewToggleButton: {
		height: controlSize._5,
		borderWidth: 0,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		paddingInline: controlSize._2,
	},
	viewToggleButtonActive: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	viewportBadge: {
		display: "inline-flex",
		alignItems: "center",
		gap: controlSize._1,
		maxWidth: "12rem",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.background,
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		paddingBlock: "0.125rem",
		paddingInline: controlSize._1_5,
	},
	viewportBadgeLive: {
		borderColor: color.accentBorder,
		backgroundColor: color.controlActive,
		color: color.textSoft,
	},
	simulatorSurface: {
		position: "relative",
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
		padding: controlSize._3,
	},
	farmGrid: {
		display: "grid",
		width: "100%",
		minHeight: 0,
		gridTemplateColumns: "repeat(auto-fill, minmax(13.5rem, 1fr))",
		alignContent: "start",
		gap: controlSize._2,
		overflowY: "auto",
	},
	farmWorkspace: {
		display: "grid",
		width: "100%",
		height: "100%",
		minHeight: 0,
		gridTemplateColumns: "minmax(0, 1fr) 19rem",
		gap: controlSize._3,
	},
	farmFleet: {
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flexDirection: "column",
		gap: controlSize._3,
		overflow: "hidden",
	},
	farmFleetHead: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._3,
		flexWrap: "wrap",
	},
	farmHeaderFilters: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		alignItems: "center",
		gap: controlSize._2,
		justifyContent: "center",
		flexWrap: "wrap",
	},
	farmHeaderFilterGroup: {
		display: "inline-flex",
		alignItems: "center",
		gap: controlSize._1,
	},
	farmTools: {
		display: "flex",
		minWidth: 0,
		alignItems: "center",
		gap: controlSize._2,
	},
	farmWall: {
		gridTemplateColumns: "repeat(auto-fill, minmax(10rem, 1fr))",
		gap: "0.1875rem",
		padding: "0.1875rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.backgroundRaised,
	},
	farmList: {
		display: "flex",
		minHeight: 0,
		flex: 1,
		flexDirection: "column",
		overflowY: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.background,
	},
	farmListRow: {
		display: "grid",
		gridTemplateColumns: "1rem minmax(10rem, 1.5fr) minmax(9rem, 1fr) 6rem",
		minHeight: "2.75rem",
		alignItems: "center",
		gap: controlSize._2,
		borderWidth: 0,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		paddingInline: controlSize._3,
		textAlign: "left",
	},
	farmListRowActive: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	farmStateDot: {
		width: "0.4375rem",
		height: "0.4375rem",
		borderRadius: "999px",
		backgroundColor: color.textFaint,
	},
	farmStateDotLive: {
		backgroundColor: color.success,
		boxShadow: "0 0 0 3px color-mix(in srgb, currentColor 16%, transparent)",
	},
	farmStateDotBoot: {
		backgroundColor: color.warning,
		boxShadow: "0 0 0 3px color-mix(in srgb, currentColor 16%, transparent)",
	},
	farmListStatus: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		textTransform: "uppercase",
	},
	farmTile: {
		position: "relative",
		display: "flex",
		minHeight: "12.5rem",
		flexDirection: "column",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.background,
	},
	farmTileLive: {
		borderColor: color.borderStrong,
	},
	farmTileActive: {
		borderColor: color.accentBorder,
		backgroundColor: color.controlActive,
		boxShadow:
			"inset 0 0 0 1px color-mix(in srgb, currentColor 8%, transparent)",
	},
	farmDevicePlaceholder: {
		display: "flex",
		width: "100%",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		color: color.textFaint,
	},
	farmPreview: {
		position: "relative",
		display: "flex",
		minHeight: 0,
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
		borderWidth: 0,
		backgroundColor: color.background,
		padding: controlSize._2,
	},
	farmStatusBadge: {
		position: "absolute",
		top: controlSize._2,
		left: controlSize._2,
		zIndex: 1,
		display: "inline-flex",
		alignItems: "center",
		gap: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.pill,
		backgroundColor: color.backgroundOverlay,
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		paddingBlock: "0.125rem",
		paddingInline: controlSize._1_5,
	},
	farmStatusBadgeLive: {
		borderColor: color.successBorder,
		color: color.textSoft,
	},
	farmStatusBadgeBoot: {
		borderColor: color.warningBorder,
		color: color.textSoft,
	},
	farmStatusDot: {
		width: "0.375rem",
		height: "0.375rem",
		borderRadius: radius.pill,
		backgroundColor: "currentColor",
	},
	farmTileOverlay: {
		position: "absolute",
		inset: 0,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "color-mix(in srgb, black 55%, transparent)",
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	farmEmptyState: {
		display: "flex",
		minHeight: "10rem",
		gridColumn: "1 / -1",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._2,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: color.border,
		borderRadius: radius.md,
		color: color.textMuted,
		fontSize: font.size_2,
	},
	farmTileBar: {
		display: "flex",
		minHeight: controlSize._9,
		alignItems: "center",
		gap: controlSize._2,
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		backgroundColor: color.backgroundRaised,
		paddingInline: controlSize._2,
	},
	farmTileText: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		flexDirection: "column",
		gap: "0.0625rem",
	},
	farmFocusPane: {
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flexDirection: "column",
		gap: controlSize._3,
		overflowY: "auto",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		paddingLeft: controlSize._3,
	},
	farmFocusPreview: {
		position: "relative",
		display: "flex",
		minHeight: "18rem",
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.background,
		padding: controlSize._2,
	},
	farmFocusInfo: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		padding: controlSize._3,
	},
	farmFocusActions: {
		display: "flex",
		gap: controlSize._2,
	},
	farmPanelHeader: {
		display: "flex",
		minHeight: controlSize._9,
		alignItems: "center",
		justifyContent: "space-between",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.backgroundRaised,
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		paddingInline: controlSize._3,
	},
	farmPanelCount: {
		color: color.textFaint,
		fontSize: font.size_1,
	},
	streamOverlay: {
		position: "absolute",
		left: "50%",
		top: controlSize._3,
		display: "flex",
		transform: "translateX(-50%)",
		alignItems: "center",
		gap: controlSize._2,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._3,
		pointerEvents: "none",
	},
	canvas: {
		width: "auto",
		maxWidth: "100%",
		height: "100%",
		borderRadius: radius.lg,
		backgroundColor: color.background,
		cursor: "crosshair",
		touchAction: "none",
		userSelect: "none",
	},
	streamEmpty: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		gap: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_3,
		textAlign: "center",
	},
	emptyText: {
		color: color.textMuted,
		fontSize: font.size_3,
		padding: controlSize._2,
	},
});
