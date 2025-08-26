import { usb } from "usb";
import { promises as fs } from "fs";
import { join, basename, dirname, extname } from "path";
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
import Store from "electron-store";
import { EventEmitter } from "events";

class KindleDetector extends EventEmitter {
  constructor() {
    super();
    this.store = new Store({ name: "kindle-devices" });
    this.connectedDevices = new Map();
    this.monitoring = false;

    this.attachListener = this.handleAttach.bind(this);
    this.detachListener = this.handleDetach.bind(this);

    this.kindleVendorId = 0x1949;
    this.kindleProducts = {
      0x0414: { name: "Kindle Scribe", generation: "1st Gen", hasAnnotations: true },
      // Add other known Kindle product IDs here
    };

    this.mountPaths = {
      win32: [],
      darwin: ["/Volumes"],
      linux: ["/media", "/mnt", "/run/media"],
    };
  }

  adaptDevice(device) {
    const { idVendor, idProduct } = device.deviceDescriptor;
    return {
      vendorId: idVendor,
      productId: idProduct,
      serialNumber: device.serialNumber,
    };
  }

  async handleAttach(device) {
    if (this.isKindleDevice(device)) {
      await this.handleDeviceConnected(this.adaptDevice(device));
    }
  }

  async handleDetach(device) {
    if (this.isKindleDevice(device)) {
      await this.handleDeviceDisconnected(this.adaptDevice(device));
    }
  }

  startMonitoring() {
    if (this.monitoring) return;
    this.monitoring = true;
    this.scanForDevices();
    usb.on("attach", this.attachListener);
    usb.on("detach", this.detachListener);
    this.emit("monitoring-started");
  }

  stopMonitoring() {
    if (!this.monitoring) return;
    usb.removeListener("attach", this.attachListener);
    usb.removeListener("detach", this.detachListener);
    this.monitoring = false;
    this.connectedDevices.clear();
    this.emit("monitoring-stopped");
  }

  isKindleDevice(device) {
    return device.deviceDescriptor && device.deviceDescriptor.idVendor === this.kindleVendorId;
  }

  async scanForDevices() {
    try {
      const devices = usb.getDeviceList();
      for (const device of devices) {
        if (this.isKindleDevice(device)) {
          await this.handleDeviceConnected(this.adaptDevice(device));
        }
      }
      await this.scanMountPoints();
      return Array.from(this.connectedDevices.values());
    } catch (error) {
      console.error("Error scanning for devices:", error);
      return [];
    }
  }

  async scanMountPoints() {
    const platform = process.platform;
    if (platform === "win32") {
      await this.scanWindowsDrives();
      return;
    }
    const mountPaths = this.mountPaths[platform] || [];
    for (const mountPath of mountPaths) {
      try {
        const entries = await fs.readdir(mountPath);
        for (const entry of entries) {
          const fullPath = join(mountPath, entry);
          if (await this.isKindleVolume(fullPath)) {
            const deviceInfo = await this.getKindleVolumeInfo(fullPath);
            if (deviceInfo && !this.connectedDevices.has(deviceInfo.serialNumber)) {
              this.connectedDevices.set(deviceInfo.serialNumber, deviceInfo);
              this.emit("device-connected", deviceInfo);
            }
          }
        }
      } catch (e) {
        /* ignore errors */
      }
    }
  }

  async scanWindowsDrives() {
    const { stdout } = await execAsync("wmic logicaldisk get name");
    const drives = stdout
      .split("\n")
      .slice(1)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const drive of drives) {
      const drivePath = `${drive}\\`;
      if (await this.isKindleVolume(drivePath)) {
        const deviceInfo = await this.getKindleVolumeInfo(drivePath);
        if (deviceInfo && !this.connectedDevices.has(deviceInfo.serialNumber)) {
          this.connectedDevices.set(deviceInfo.serialNumber, deviceInfo);
          this.emit("device-connected", deviceInfo);
        }
      }
    }
  }

  async isKindleVolume(volumePath) {
    try {
      const requiredDirs = ["documents", "system"];
      const checks = requiredDirs.map((dir) =>
        fs
          .stat(join(volumePath, dir))
          .then((s) => s.isDirectory())
          .catch(() => false)
      );
      const results = await Promise.all(checks);
      return results.every(Boolean);
    } catch (error) {
      return false;
    }
  }

  async getKindleVolumeInfo(volumePath) {
    try {
      const info = { mountPath: volumePath };
      const versionPath = join(volumePath, "system", "version.txt");
      const versionContent = await fs.readFile(versionPath, "utf8");
      info.model = versionContent.match(/Kindle (.+)/)?.[0]?.trim() || "Unknown Kindle";
      info.firmwareVersion = versionContent.match(/Version: (.+)/)?.[1]?.trim();
      info.isKindleScribe = info.model.toLowerCase().includes("scribe");
      info.hasAnnotations = info.isKindleScribe;

      const serialPath = join(volumePath, "system", ".mrch");
      info.serialNumber = (await fs.readFile(serialPath, "utf8")).trim().substring(0, 16);

      const spaceInfo = await this.getDiskSpace(volumePath);
      info.availableSpace = spaceInfo.available;
      info.totalSpace = spaceInfo.total;

      return info;
    } catch (error) {
      console.error("Error getting Kindle volume info:", error);
      return null;
    }
  }

  async getDiskSpace(volumePath) {
    if (process.platform === "win32") {
      const { stdout } = await execAsync(
        `wmic logicaldisk where "DeviceID='${volumePath.slice(0, 2)}'" get Size,FreeSpace /format:value`
      );
      const lines = stdout
        .trim()
        .split(/[\r\n]+/)
        .filter(Boolean);
      const diskInfo = Object.fromEntries(lines.map((line) => line.split("=")));
      return { total: Number(diskInfo.Size), available: Number(diskInfo.FreeSpace) };
    } else {
      const { stdout } = await execAsync(`df -k "${volumePath}" | tail -1`);
      const parts = stdout.trim().split(/\s+/);
      return { total: parseInt(parts[1], 10) * 1024, available: parseInt(parts[3], 10) * 1024 };
    }
  }

  async handleDeviceConnected(device) {
    // eslint-disable-next-line no-unused-vars
    console.log("Device connected:", device); // Placeholder for future device-specific handling
    // Wait for the OS to mount the device
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await this.scanMountPoints();
  }

  async handleDeviceDisconnected(device) {
    const deviceToRemove = [...this.connectedDevices.values()].find(
      (d) =>
        (d.usbVendorId === device.vendorId && d.usbProductId === device.productId) ||
        (device.serialNumber && d.serialNumber === device.serialNumber)
    );
    if (deviceToRemove) {
      this.connectedDevices.delete(deviceToRemove.serialNumber);
      this.emit("device-disconnected", deviceToRemove);
    }
  }

  async copyToKindle(deviceSerialNumber, sourcePath, destinationFolder = "documents") {
    const device = this.connectedDevices.get(deviceSerialNumber);
    if (!device) throw new Error("Device not connected");
    const fileName = basename(sourcePath);
    const destinationPath = join(device.mountPath, destinationFolder, fileName);
    await fs.copyFile(sourcePath, destinationPath);
    if (device.isKindleScribe && extname(sourcePath).toLowerCase() === ".epub") {
      await this.createKindleScribeMetadata(destinationPath);
    }
    this.emit("file-copied", { device, destinationPath });
    return { success: true, destinationPath };
  }

  async createKindleScribeMetadata(epubPath) {
    const metadataPath = epubPath.replace(/\.epub$/i, ".sdr") + "/metadata.json";
    await fs.mkdir(dirname(metadataPath), { recursive: true });
    const metadata = {
      type: "EBOK",
      asin: "",
      isUpgraded: true,
      content: { fixed: { enabled: true } },
      notebook: { enabled: true },
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  async ejectDevice(serialNumber) {
    const device = this.connectedDevices.get(serialNumber);
    if (!device) throw new Error("Device not found");
    const ejectCmd = {
      win32: `powershell -command "$drive = New-Object -comObject Shell.Application; $drive.Namespace(17).ParseName('${device.mountPath.slice(0, 2)}').InvokeVerb('Eject')"`,
      darwin: `diskutil eject "${device.mountPath}"`,
      linux: `umount "${device.mountPath}"`,
    }[process.platform];

    if (!ejectCmd) throw new Error("Eject not supported on this platform");
    await execAsync(ejectCmd);
    this.connectedDevices.delete(serialNumber);
    this.emit("device-ejected", device);
    return { success: true };
  }

  getConnectedDevices = () => Array.from(this.connectedDevices.values());
  getDevice = (serialNumber) => this.connectedDevices.get(serialNumber);
}

export { KindleDetector };
