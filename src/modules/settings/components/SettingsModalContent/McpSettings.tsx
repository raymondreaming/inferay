import type { McpAction, McpProviderStatus } from "@contracts";
import {
	fetchMcpStatus,
	updateMcpConnection,
} from "@settings/services/settingsApi.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import {
	SettingsEmpty,
	SettingsRow,
	SettingsSection,
} from "@shared/ui/SettingsSurface/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";
import { SettingsErrorBanner } from "../SettingsStatus/index.tsx";
import { styles } from "./styles.ts";

export function McpSettings() {
	return (
		<>
			<p>
				Codex and Claude have separate connections and sign-in. This checks a
				fresh provider session; tools in an existing chat can differ by project
				and session. A timeout means the connection could not be verified.
				GitKraken is disabled here.
			</p>
			<McpProvider kind="codex" />
			<McpProvider kind="claude" />
		</>
	);
}

function McpProvider(props: { kind: "codex" | "claude" }) {
	const [pending, setPending] = createSignal<string | null>(null);
	const [notice, setNotice] = createSignal<string | null>(null);
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
		try {
			const result = await updateMcpConnection({
				provider: props.kind,
				name,
				action,
			});
			setNotice(result.message);
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
			title={props.kind === "codex" ? "Codex" : "Claude"}
			description={
				connections.data.checking
					? "Checking connections…"
					: connections.data.checkedAt
						? `Last checked ${new Date(connections.data.checkedAt).toLocaleTimeString()}`
						: "Not checked yet"
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
			{connections.data.error && connections.data.servers.length > 0 && (
				<p>Showing the last successful check.</p>
			)}
			<For each={connections.data.servers} keyed={(server) => server.name}>
				{(server) => {
					const [failedIcon, setFailedIcon] = createSignal<string | null>(null);
					return (
						<SettingsRow
							label={
								<span {...stylex.attrs(styles.mcpName)}>
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
									<span>{server().source?.serverLabel ?? server().name}</span>
								</span>
							}
							description={`${server().status}${server().toolCount !== null && server().status === "Connected" ? ` · ${server().toolCount} tools` : ""}${server().version ? ` · v${server().version}` : ""}`}
						>
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
						</SettingsRow>
					);
				}}
			</For>
			{!connections.data.checking &&
				!connections.data.error &&
				connections.data.servers.length === 0 && (
					<SettingsEmpty>No MCP connections found.</SettingsEmpty>
				)}
		</SettingsSection>
	);
}
