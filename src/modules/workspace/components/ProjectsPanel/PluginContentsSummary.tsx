import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import * as stylex from "@stylexjs/stylex";
import { readPluginLibrary } from "../../services/projectsApi.ts";
import { styles } from "./styles.ts";

export function PluginContentsSummary(props: { id: string }) {
	const library = useBackgroundQuery(() => ({
		queryKey: ["plugin-library", props.id],
		queryFn: () => readPluginLibrary(props.id),
	}));
	const summary = () => library.data?.summary ?? "";
	return (
		<>
			{summary() && <span {...stylex.attrs(styles.muted)}>{summary()}</span>}
			{library.data && !summary() && (
				<span {...stylex.attrs(styles.muted)}>
					Contains automation definitions only
				</span>
			)}
			{library.error && (
				<span role="status" {...stylex.attrs(styles.muted)}>
					Contents unavailable
				</span>
			)}
		</>
	);
}
