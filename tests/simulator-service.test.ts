import { describe, expect, test } from "bun:test";
import { parseSimctlDevices } from "../src/server/services/simulator-service.ts";

describe("simulator service device parsing", () => {
	/*
	 * This protects the apps panel from showing an empty "No devices" state when
	 * simctl returns valid devices without an explicit isAvailable field. Apple
	 * has changed this JSON shape across Xcode/CoreSimulator versions, so only an
	 * explicit false should hide a device.
	 */
	test("keeps available devices when isAvailable is missing and skips explicit unavailable devices", () => {
		expect(
			parseSimctlDevices({
				devices: {
					"com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
						{
							udid: "available-without-flag",
							name: "iPhone 17",
							state: "Shutdown",
						},
						{
							udid: "unavailable",
							name: "iPhone 15",
							state: "Shutdown",
							isAvailable: false,
						},
						{
							udid: "booted",
							name: "iPad Pro",
							state: "Booted",
							isAvailable: true,
						},
					],
				},
			})
		).toEqual([
			{
				udid: "available-without-flag",
				name: "iPhone 17",
				state: "Shutdown",
				runtime: "iOS-26-0",
				isAvailable: true,
			},
			{
				udid: "booted",
				name: "iPad Pro",
				state: "Booted",
				runtime: "iOS-26-0",
				isAvailable: true,
			},
		]);
	});
});
