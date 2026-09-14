import { AgentIcon } from "@agents/components/AgentIcon/index.tsx";
import type { McpAction, McpProviderStatus } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import {
	fetchMcpStatus,
	updateMcpConnection,
} from "@settings/services/settingsApi.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import {
	SettingsEmpty,
	SettingsSection,
} from "@shared/ui/SettingsSurface/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";
import { SettingsErrorBanner } from "../SettingsStatus/index.tsx";
import { styles } from "./styles.ts";

export function McpSettings() {
	return (
		<div {...stylex.attrs(styles.mcpGrid)}>
			<McpProvider kind="claude" />
			<McpProvider kind="codex" />
		</div>
	);
}

function McpProvider(props: { kind: "codex" | "claude" }) {
	const [pending, setPending] = createSignal<string | null>(null);
	const [notice, setNotice] = createSignal<string | null>(null);
	const [loginUrl, setLoginUrl] = createSignal<string | undefined>();
	const [refreshError, setRefreshError] = createSignal<string | null>(null);
	const connections = useQueryResource(
		() => (signal?: AbortSignal) => fetchMcpStatus(props.kind, signal),
		(): McpProviderStatus => ({
			checking: false,
			checkedAt: null,
			error: null,
			servers: [],
		}),
		() => ({ queryKey: ["agents", "mcp", props.kind], refetchInterval: 2000 }),
	);
	const refresh = async () => {
		setRefreshError(null);
		try {
			connections.setData(await fetchMcpStatus(props.kind, undefined, true));
		} catch (error) {
			setRefreshError(error instanceof Error ? error.message : String(error));
		}
	};
	const changeConnection = async (
		name: string,
		action: McpAction["action"],
	) => {
		setPending(name);
		setRefreshError(null);
		setNotice(null);
		setLoginUrl(undefined);
		try {
			const result = await updateMcpConnection({
				provider: props.kind,
				name,
				action,
			});
			setNotice(result.message);
			setLoginUrl(result.url);
			await connections.refresh();
		} catch (error) {
			setRefreshError(error instanceof Error ? error.message : String(error));
		} finally {
			setPending(null);
		}
	};
	return (
		<SettingsSection
			id={`mcp-${props.kind}`}
			title={
				<span {...stylex.attrs(styles.mcpName)}>
					<AgentIcon kind={props.kind} size={iconSize.lg} />
					{props.kind === "codex" ? "Codex" : "Claude"}
				</span>
			}
			description={
				connections.data.checking ||
				(!connections.loaded && connections.loading)
					? "Checking…"
					: connections.data.error || connections.error || refreshError()
						? "Check unavailable"
						: `${connections.data.servers.filter((server) => server.status === "Connected").length} connected`
			}
			action={
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={connections.data.checking || pending() !== null}
					onClick={() => void refresh()}
				>
					Refresh
				</Button>
			}
		>
			{(refreshError() ?? connections.error ?? connections.data.error) && (
				<SettingsErrorBanner
					message={
						(refreshError() ?? connections.error ?? connections.data.error)!
					}
				/>
			)}
			{notice() && <p role="status">{notice()}</p>}
			{loginUrl() && (
				<a href={loginUrl()} target="_blank" rel="noopener noreferrer">
					Open Claude connections
				</a>
			)}
			{connections.data.error && connections.data.servers.length > 0 && (
				<span {...stylex.attrs(styles.mcpStatus)}>Last known status</span>
			)}
			<For each={connections.data.servers} keyed={(server) => server.name}>
				{(server) => {
					const [failedIcon, setFailedIcon] = createSignal<string | null>(null);
					return (
						<article {...stylex.attrs(styles.mcpCard)}>
							<div {...stylex.attrs(styles.mcpName)}>
								<span {...stylex.attrs(styles.mcpIcon)} aria-hidden="true">
									<Show
										when={
											server().iconUrl && server().iconUrl !== failedIcon()
												? server().iconUrl
												: undefined
										}
										keyed
										fallback={server().source?.monogram ?? "M"}
									>
										{(url) => (
											<img
												{...stylex.attrs(styles.mcpImage)}
												src={url}
												alt=""
												draggable={false}
												onError={() => setFailedIcon(url)}
											/>
										)}
									</Show>
								</span>
								<div {...stylex.attrs(styles.mcpIdentity)}>
									<span {...stylex.attrs(styles.mcpLabel)}>
										{server().source?.serverLabel ?? server().name}
									</span>
									<span
										{...stylex.attrs(
											styles.mcpStatus,
											server().status === "Connected" && styles.mcpConnected,
										)}
									>
										{server().status}
									</span>
								</div>
							</div>
							<div {...stylex.attrs(styles.mcpActions)}>
								{server().canToggle && (
									<>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={connections.data.checking || pending() !== null}
											onClick={() =>
												void changeConnection(
													server().name,
													server().status === "Connected"
														? "reconnect"
														: "connect",
												)
											}
										>
											{pending() === server().name
												? "Working…"
												: server().status === "Connected"
													? "Reconnect"
													: server().status === "Disabled"
														? "Enable"
														: "Connect"}
										</Button>
										{server().status !== "Disabled" && (
											<Button
												type="button"
												variant="ghost"
												size="sm"
												disabled={
													connections.data.checking || pending() !== null
												}
												onClick={() =>
													void changeConnection(server().name, "disable")
												}
											>
												Disable
											</Button>
										)}
									</>
								)}
							</div>
						</article>
					);
				}}
			</For>
			{connections.loaded &&
				!connections.data.checking &&
				!connections.data.error &&
				!connections.error &&
				connections.data.servers.length === 0 && (
					<SettingsEmpty>No MCP connections found.</SettingsEmpty>
				)}
		</SettingsSection>
	);
}
