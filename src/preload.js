const { contextBridge, ipcRenderer } = require("electron");

// Expose API to renderer process
try {
  contextBridge.exposeInMainWorld("electronAPI", {
    // File operations
    selectPDFFiles: () => ipcRenderer.invoke("select-pdf-files"),
    selectPDFFolder: () => ipcRenderer.invoke("select-pdf-folder"),
    selectOutputDirectory: () => ipcRenderer.invoke("select-output-directory"),
    openFileLocation: (filePath) => ipcRenderer.invoke("open-file-location", filePath),

    // Conversion
    convertPDF: (options) => ipcRenderer.invoke("convert-pdf", options),

    // Settings
    getSettings: () => ipcRenderer.invoke("get-settings"),
    saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

    // Kindle Device
    kindleGetDevices: () => ipcRenderer.invoke("kindle-get-devices"),
    kindleCopyFile: (serial, sourcePath) =>
      ipcRenderer.invoke("kindle-copy-file", { serial, sourcePath }),
    kindleEjectDevice: (serial) => ipcRenderer.invoke("kindle-eject-device", serial),
    sendToKindle: (options) => ipcRenderer.invoke("send-to-kindle", options),

    // App info & utilities
    getAppInfo: () => ipcRenderer.invoke("get-app-info"),
    formatFileSize: (bytes) => {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    },

    // Listeners
    onConversionProgress: (callback) =>
      ipcRenderer.on("conversion-progress", (event, data) => callback(data)),
    onMenuAction: (action, callback) =>
      ipcRenderer.on("menu-action", (event, name) => {
        if (name === action) callback();
      }),
    onFileOpened: (callback) =>
      ipcRenderer.on("file-opened", (event, filePath) => callback(filePath)),
    onKindleDeviceConnected: (callback) =>
      ipcRenderer.on("kindle-device-connected", (event, device) => callback(device)),
    onKindleDeviceDisconnected: (callback) =>
      ipcRenderer.on("kindle-device-disconnected", (event, device) => callback(device)),
    onWindowFocusChanged: (callback) =>
      ipcRenderer.on("window-focus-changed", (event, focused) => callback(focused)),
    onWindowMinimized: (callback) => ipcRenderer.on("window-minimized", () => callback()),
    onWindowRestored: (callback) => ipcRenderer.on("window-restored", () => callback()),

    // Notifications
    showNotification: (title, body) => {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body });
      }
    },

    // Window controls
    minimizeWindow: () => ipcRenderer.invoke("window-minimize"),
    maximizeWindow: () => ipcRenderer.invoke("window-maximize"),
    closeWindow: () => ipcRenderer.invoke("window-close"),
  });
} catch (error) {
  console.error("Failed to load preload script:", error);
}
