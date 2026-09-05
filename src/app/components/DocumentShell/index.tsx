import {
	Body,
	Head,
	HeadContent,
	Html,
	Scripts,
} from "@octanejs/tanstack-router";

import "../../../design-system/styles.css";
import "virtual:stylex.css";

export function DocumentShell({ children }: { readonly children?: unknown }) {
	return (
		<Html lang="en">
			<Head>
				<HeadContent />
			</Head>
			<Body>
				{children}
				<Scripts />
			</Body>
		</Html>
	);
}
