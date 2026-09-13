export type DockTree =
	| { readonly type: "empty"; readonly columns: number }
	| {
			readonly type: "panel";
			readonly id: string;
	  }
	| {
			readonly type: "split";
			readonly direction: "horizontal" | "vertical";
			readonly ratio: number;
			readonly first: DockTree;
			readonly second: DockTree;
	  };

export type DockSplitNode = Extract<DockTree, { readonly type: "split" }>;
