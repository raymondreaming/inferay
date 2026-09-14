import type { DockTree } from "@contracts";

export type DockSplitNode = Extract<DockTree, { readonly type: "split" }>;
