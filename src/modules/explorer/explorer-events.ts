export const DOCUMENT_OPEN_EVENT = "workspace-file-open";

export type DocumentOpenDetail = {
	readonly cwd: string;
	readonly path: string;
};

export function dispatchDocumentOpen(detail: DocumentOpenDetail) {
	window.dispatchEvent(
		new CustomEvent<DocumentOpenDetail>(DOCUMENT_OPEN_EVENT, {
			detail,
		}),
	);
}
