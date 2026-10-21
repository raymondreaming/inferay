import type { DecoratedTextSegment, LinkMetadata } from "@contracts";
import { loadLinkMetadata } from "@conversation/services/conversationApi.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { project as rustProject } from "@shared/lib/native.tsx";
import { IconExternalLink } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";
import { styles } from "./styles.ts";

type DecoratedTextProps = {
	text: string;
	slashCommandNames?: readonly string[];
	pills?: boolean;
};

/** Keep segment elements alive as their text changes during typing or edits. */
export function DecoratedText(props: DecoratedTextProps) {
	const segments = createMemo(() =>
		decoratedTextSegments(props.text, props.slashCommandNames),
	);
	return (
		<For each={segments()} keyed={false}>
			{(segment) => (
				<Show
					when={props.pills && segment().url}
					fallback={
						<span
							{...stylex.attrs(
								segment().highlighted
									? props.pills
										? styles.pill
										: styles.highlight
									: props.pills
										? null
										: styles.text,
							)}
						>
							{segment().text}
						</span>
					}
				>
					<LinkBadge url={segment().url!} />
				</Show>
			)}
		</For>
	);
}

export function InputHighlights(props: Omit<DecoratedTextProps, "pills">) {
	return (
		<Show
			when={props.text.length > 0}
			fallback={<span {...stylex.attrs(styles.transparent)}>{"\u00A0"}</span>}
		>
			<DecoratedText
				text={props.text}
				slashCommandNames={props.slashCommandNames}
			/>
		</Show>
	);
}

function decoratedTextSegments(
	text: string,
	slashCommandNames?: readonly string[],
): DecoratedTextSegment[] {
	return rustProject("decoratedTextSegments", {
		text,
		commands: slashCommandNames,
	});
}

function LinkBadge(props: { url: string }) {
	const hostname = () => {
		try {
			return new URL(props.url).hostname.replace(/^www\./, "");
		} catch {
			return props.url;
		}
	};
	const metadata = useQueryResource<LinkMetadata>(() => ({
		queryKey: ["link-metadata", props.url],
		queryFn: ({ signal }) => loadLinkMetadata(props.url, signal),
		initialData: { title: null, icon: null },
		staleTime: 60 * 60 * 1000,
		gcTime: 60 * 60 * 1000,
		retry: false,
	}));
	const [failedIcon, setFailedIcon] = createSignal<string>();
	return (
		<a
			href={props.url}
			target="_blank"
			rel="noopener noreferrer"
			title={props.url}
			{...stylex.attrs(styles.linkBadge)}
		>
			<Show
				when={metadata.data.icon && failedIcon() !== metadata.data.icon}
				fallback={<IconExternalLink size={14} />}
			>
				<img
					src={metadata.data.icon!}
					alt=""
					width={16}
					height={16}
					{...stylex.attrs(styles.linkIcon)}
					onError={() => setFailedIcon(metadata.data.icon!)}
				/>
			</Show>
			<span {...stylex.attrs(styles.linkTitle)}>
				{metadata.data.title || hostname()}
			</span>
			<Show when={metadata.data.title}>
				<span {...stylex.attrs(styles.linkHost)}>{hostname()}</span>
			</Show>
		</a>
	);
}
