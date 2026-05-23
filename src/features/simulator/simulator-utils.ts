export function isBootedSimulatorDevice(device: { state: string }): boolean {
	return device.state === "Booted";
}
