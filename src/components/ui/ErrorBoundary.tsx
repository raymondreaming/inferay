import type React from "react";
import { Component } from "react";

export class ErrorBoundary extends Component<
	{ children: React.ReactNode },
	{ error: string | null }
> {
	override state = { error: null };
	static getDerivedStateFromError(error: unknown) {
		return {
			error:
				error instanceof Error
					? `${error.name}: ${error.message}`
					: String(error),
		};
	}
	override componentDidCatch(error: unknown, errorInfo: unknown) {
		console.error("Inferay render crash", error, errorInfo);
		// Auto-recover after a short delay
		setTimeout(() => this.setState({ error: null }), 1500);
	}
	override render() {
		if (this.state.error) {
			return (
				<div className="flex h-screen items-center justify-center bg-inferay-black p-6">
					<div className="max-w-xl rounded-lg border border-white/10 bg-white/[0.04] p-4 text-inferay-soft-white shadow-2xl">
						<p className="text-sm font-semibold">
							Recovering from a render crash
						</p>
						<p className="mt-2 break-words font-mono text-xs text-white/60">
							{this.state.error}
						</p>
					</div>
				</div>
			);
		}
		return this.props.children;
	}
}
