export type FileContentResponse = {
	readonly content: string;
	readonly cwd: string;
	readonly path: string;
	readonly size: number;
	readonly updatedAt: number;
};
