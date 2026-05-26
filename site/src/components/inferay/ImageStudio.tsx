import React, { useState } from "react";
import { Icons } from "./Icons";

type GeneratedImage = {
	id: string;
	prompt: string;
	model: string;
	url: string;
	timestamp: string;
	aspectRatio: string;
};

const sampleImages: GeneratedImage[] = [
	{
		id: "1",
		prompt: "A futuristic city at sunset with flying cars and neon lights",
		model: "fal-flux",
		url: "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=400&h=400&fit=crop",
		timestamp: "2m ago",
		aspectRatio: "1:1",
	},
	{
		id: "2",
		prompt: "Abstract geometric patterns in deep purple and gold",
		model: "fal-flux",
		url: "https://images.unsplash.com/photo-1550859492-d5da9d8e45f3?w=400&h=400&fit=crop",
		timestamp: "15m ago",
		aspectRatio: "1:1",
	},
	{
		id: "3",
		prompt: "Minimalist workspace with natural light and plants",
		model: "fal-flux-pro",
		url: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&h=400&fit=crop",
		timestamp: "1h ago",
		aspectRatio: "16:9",
	},
	{
		id: "4",
		prompt: "Ocean waves crashing on rocky coastline at golden hour",
		model: "fal-flux",
		url: "https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=400&h=400&fit=crop",
		timestamp: "2h ago",
		aspectRatio: "1:1",
	},
];

const models = [
	{ id: "fal-flux", name: "Flux", speed: "Fast" },
	{ id: "fal-flux-pro", name: "Flux Pro", speed: "Quality" },
	{ id: "fal-flux-dev", name: "Flux Dev", speed: "Experimental" },
];

const aspectRatios = [
	{ id: "1:1", label: "1:1", width: 1024, height: 1024 },
	{ id: "16:9", label: "16:9", width: 1024, height: 576 },
	{ id: "9:16", label: "9:16", width: 576, height: 1024 },
	{ id: "4:3", label: "4:3", width: 1024, height: 768 },
];

function ImageCard({
	image,
	isSelected,
	onSelect,
}: {
	image: GeneratedImage;
	isSelected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={`group relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
				isSelected
					? "border-inferay-accent ring-2 ring-inferay-accent/20"
					: "border-transparent hover:border-inferay-border"
			}`}
		>
			<img
				src={image.url}
				alt={image.prompt}
				className="w-full h-full object-cover"
			/>
			{/* Hover overlay */}
			<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
				<div className="absolute bottom-0 left-0 right-0 p-2">
					<p className="text-[8px] text-white/90 line-clamp-2 leading-relaxed">
						{image.prompt}
					</p>
				</div>
			</div>
			{/* Model badge */}
			<div className="absolute top-1.5 right-1.5">
				<span className="px-1.5 py-0.5 rounded bg-black/60 text-[7px] text-white/80 backdrop-blur-sm">
					{image.model.replace("fal-", "")}
				</span>
			</div>
		</button>
	);
}

function ImageDetail({
	image,
	onClose,
}: {
	image: GeneratedImage;
	onClose: () => void;
}) {
	return (
		<div className="flex h-full flex-col bg-inferay-bg">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-inferay-border px-3 h-8">
				<span className="text-[10px] font-medium text-inferay-text">
					Details
				</span>
				<button
					type="button"
					onClick={onClose}
					className="p-1 rounded text-inferay-text-3 hover:bg-inferay-surface hover:text-inferay-text-2 transition-colors"
				>
					<Icons.Close />
				</button>
			</div>

			{/* Preview */}
			<div className="p-3">
				<div className="rounded-lg overflow-hidden border border-inferay-border">
					<img
						src={image.url}
						alt={image.prompt}
						className="w-full aspect-square object-cover"
					/>
				</div>
			</div>

			{/* Info */}
			<div className="flex-1 overflow-y-auto px-3 space-y-3">
				<div>
					<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
						Prompt
					</span>
					<p className="mt-1 text-[9px] text-inferay-text leading-relaxed">
						{image.prompt}
					</p>
				</div>

				<div className="flex gap-3">
					<div>
						<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
							Model
						</span>
						<p className="mt-1 text-[9px] text-inferay-text">
							{image.model.replace("fal-", "").charAt(0).toUpperCase() +
								image.model.replace("fal-", "").slice(1)}
						</p>
					</div>
					<div>
						<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
							Ratio
						</span>
						<p className="mt-1 text-[9px] text-inferay-text">
							{image.aspectRatio}
						</p>
					</div>
					<div>
						<span className="text-[8px] font-medium uppercase tracking-wide text-inferay-text-3">
							Created
						</span>
						<p className="mt-1 text-[9px] text-inferay-text">
							{image.timestamp}
						</p>
					</div>
				</div>
			</div>

			{/* Actions */}
			<div className="shrink-0 p-3 border-t border-inferay-border space-y-2">
				<button
					type="button"
					className="w-full h-7 rounded-md bg-inferay-surface-2 border border-inferay-border text-[10px] font-medium text-inferay-text hover:bg-inferay-accent hover:text-black hover:border-inferay-accent transition-colors"
				>
					Start chat
				</button>
				<div className="flex gap-2">
					<button
						type="button"
						className="flex-1 h-6 rounded-md border border-inferay-border text-[9px] text-inferay-text-3 hover:bg-inferay-surface transition-colors"
					>
						Select
					</button>
					<button
						type="button"
						className="flex-1 h-6 rounded-md border border-inferay-border text-[9px] text-inferay-text-3 hover:bg-inferay-surface transition-colors"
					>
						Delete
					</button>
				</div>
			</div>
		</div>
	);
}

export function ImageStudio() {
	const [images, setImages] = useState<GeneratedImage[]>(sampleImages);
	const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(
		null
	);
	const [prompt, setPrompt] = useState("");
	const [model, setModel] = useState("fal-flux");
	const [aspectRatio, setAspectRatio] = useState("1:1");
	const [isGenerating, setIsGenerating] = useState(false);

	const handleGenerate = () => {
		if (!prompt.trim()) return;
		setIsGenerating(true);
		// Simulate generation
		setTimeout(() => {
			const newImage: GeneratedImage = {
				id: Date.now().toString(),
				prompt: prompt.trim(),
				model,
				url: `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 100000000)}?w=400&h=400&fit=crop`,
				timestamp: "Just now",
				aspectRatio,
			};
			setImages([newImage, ...images]);
			setPrompt("");
			setIsGenerating(false);
		}, 1500);
	};

	return (
		<div className="flex h-full w-full flex-col bg-inferay-bg">
			{/* Generation Panel */}
			<div className="shrink-0 border-b border-inferay-border p-3 space-y-3">
				{/* Prompt input */}
				<div className="relative">
					<textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="Describe the image you want to create..."
						rows={2}
						className="w-full rounded-lg bg-inferay-surface border border-inferay-border px-3 py-2 text-[11px] text-inferay-text placeholder:text-inferay-text-3 outline-none focus:border-inferay-accent/50 resize-none"
					/>
				</div>

				{/* Controls row */}
				<div className="flex items-center gap-2">
					{/* Model selector */}
					<div className="flex items-center gap-1 h-7 px-2 rounded-md bg-inferay-surface border border-inferay-border">
						<span className="text-[8px] text-inferay-text-3">Model:</span>
						<select
							value={model}
							onChange={(e) => setModel(e.target.value)}
							className="bg-transparent text-[9px] text-inferay-text outline-none cursor-pointer"
						>
							{models.map((m) => (
								<option key={m.id} value={m.id}>
									{m.name}
								</option>
							))}
						</select>
					</div>

					{/* Aspect ratio */}
					<div className="flex items-center gap-0.5">
						{aspectRatios.map((ar) => (
							<button
								key={ar.id}
								onClick={() => setAspectRatio(ar.id)}
								className={`h-6 px-2 rounded-md text-[8px] font-medium transition-colors ${
									aspectRatio === ar.id
										? "bg-inferay-surface-2 border border-inferay-border text-inferay-text"
										: "text-inferay-text-3 hover:text-inferay-text-2 border border-transparent"
								}`}
							>
								{ar.label}
							</button>
						))}
					</div>

					<div className="flex-1" />

					{/* Generate button */}
					<button
						type="button"
						onClick={handleGenerate}
						disabled={!prompt.trim() || isGenerating}
						className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-inferay-accent text-black text-[10px] font-medium hover:bg-inferay-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{isGenerating ? (
							<>
								<div className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
								Generating...
							</>
						) : (
							<>
								<Icons.Sparkle />
								Generate
							</>
						)}
					</button>
				</div>
			</div>

			{/* Content */}
			<div className="flex flex-1 min-h-0 overflow-hidden">
				{/* Gallery grid */}
				<div className="flex-1 overflow-y-auto p-3">
					{images.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full text-center">
							<div className="w-12 h-12 rounded-full bg-inferay-surface border border-inferay-border flex items-center justify-center mb-3">
								<Icons.Sparkle className="w-5 h-5 text-inferay-text-3" />
							</div>
							<p className="text-[11px] text-inferay-text mb-1">
								No images yet
							</p>
							<p className="text-[9px] text-inferay-text-3">
								Enter a prompt above to generate your first image
							</p>
						</div>
					) : (
						<div className="grid grid-cols-3 gap-2">
							{images.map((image) => (
								<ImageCard
									key={image.id}
									image={image}
									isSelected={selectedImage?.id === image.id}
									onSelect={() => setSelectedImage(image)}
								/>
							))}
						</div>
					)}
				</div>

				{/* Detail panel */}
				{selectedImage && (
					<div className="w-[220px] shrink-0 border-l border-inferay-border">
						<ImageDetail
							image={selectedImage}
							onClose={() => setSelectedImage(null)}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
