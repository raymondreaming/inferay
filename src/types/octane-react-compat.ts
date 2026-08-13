import type { OctaneNode } from "octane";
import type { Octane, OctaneElement } from "octane/jsx-runtime";
import type * as ReactTypes from "react";

/** Type-only aliases used by the vendored Gooey source. Runtime behavior is
 * entirely Octane-native. */
export type ReactNode = OctaneNode;
export type ReactElement<P = any> = OctaneElement<P>;
export type CSSProperties = ReactTypes.CSSProperties;
export type Ref<T> = Octane.Ref<T>;
