export interface SimulatorDevice {
	udid: string;
	name: string;
	state: "Booted" | "Shutdown" | string;
	runtime: string;
	isAvailable: boolean;
}

export interface BaguetteStatus {
	installed: boolean;
	running: boolean;
	port: number;
	baseUrl: string;
	error?: string;
}

export interface SimulatorProject {
	id: string;
	name: string;
	kind: "xcode" | "react-native";
	path: string;
	projectPath?: string;
	workspacePath?: string;
	iosPath?: string;
	schemes: string[];
	defaultScheme?: string;
	bundleId?: string | null;
	bootedDeviceUdid?: string | null;
	installed: boolean;
	running: boolean;
}
