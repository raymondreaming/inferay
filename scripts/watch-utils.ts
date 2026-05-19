export function resolveExitCode(
	resolve: (code: number) => void,
	code: number | null
): void {
	resolve(code ?? 0);
}
