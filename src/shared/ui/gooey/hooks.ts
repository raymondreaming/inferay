import { useEffect, useLayoutEffect } from "octane";

export const useIsoLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;
