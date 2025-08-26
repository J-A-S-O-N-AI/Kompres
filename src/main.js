import "./polyfills.js"; // Must be the first import to patch the environment
import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from "electron";
import { join, basename, dirname } from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import { PDFConverter } from "./converter.js";
import { OCRProcessor } from "./ocr.js";
// import { CloudStorageManager } from "./cloud-storage.js"; // Placeholder for future cloud storage features
import { KindleDetector } from "./kindle-detector.js";
import Store from "electron-store";

const store = new Store();
let mainWindow = null;
const isDev = process.argv.includes("--dev");

// Singletons for services
const converter = new PDFConverter();
const ocrProcessor = new OCRProcessor();
// const cloudStorage = new CloudStorageManager(); // Placeholder for future cloud storage features
const kindleDetector = new KindleDetector();

function createWindow() {
  const __dirname_esm = dirname(fileURLToPath(import.meta.url));

  // Load window state from store
  const windowState = store.get("windowState", {
    width: 1200,
    height: 800,
    x: undefined,
    y: undefined,
    isMaximized: false,
  });

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname_esm, "preload.js"),
      // Security improvements
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      // Additional settings for debugging
      devTools: isDev,
    },
    icon: join(__dirname_esm, "..", "assets", "icon.png"),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    // Better window behavior across platforms
    ...(process.platform === "win32" && {
      frame: true,
      titleBarOverlay: false,
    }),
  });

  // Restore maximized state
  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile(join(__dirname_esm, "..", "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Save window state on resize/move
  mainWindow.on("resize", saveWindowState);
  mainWindow.on("move", saveWindowState);
  mainWindow.on("maximize", () => saveWindowState(true));
  mainWindow.on("unmaximize", () => saveWindowState(false));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Enhanced window event handling
  mainWindow.on("focus", () => {
    mainWindow.webContents.send("window-focus-changed", true);
  });

  mainWindow.on("blur", () => {
    mainWindow.webContents.send("window-focus-changed", false);
  });

  // Handle window minimize/restore for better UX
  mainWindow.on("minimize", () => {
    mainWindow.webContents.send("window-minimized");
  });

  mainWindow.on("restore", () => {
    mainWindow.webContents.send("window-restored");
  });

  // Forward Kindle events to renderer
  kindleDetector.on("device-connected", (device) =>
    mainWindow?.webContents.send("kindle-device-connected", device)
  );
  kindleDetector.on("device-disconnected", (device) =>
    mainWindow?.webContents.send("kindle-device-disconnected", device)
  );
  kindleDetector.startMonitoring();
}

function saveWindowState(isMaximized = null) {
  if (!mainWindow) return;

  const bounds = mainWindow.getBounds();
  const maximized = isMaximized !== null ? isMaximized : mainWindow.isMaximized();

  store.set("windowState", {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: maximized,
  });
}

function createMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Preferences...",
                accelerator: "Cmd+,",
                click: () => mainWindow?.webContents.send("menu-action", "settings"),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open PDF...",
          accelerator: "CmdOrCtrl+O",
          click: () => mainWindow?.webContents.send("menu-action", "open-file"),
        },
        {
          label: "Open Folder...",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => mainWindow?.webContents.send("menu-action", "open-folder"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "About",
          click: () => mainWindow?.webContents.send("menu-action", "about"),
        },
        {
          label: "Learn More",
          click: async () => await shell.openExternal("https://jasonet.cc"),
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC Handlers
async function handleFileSelection(event, properties) {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) return [];

  try {
    // Ensure window is focused before showing dialog (fixes Windows 11 issues)
    if (process.platform === "win32") {
      parentWindow.setAlwaysOnTop(true);
      parentWindow.focus();
      parentWindow.setAlwaysOnTop(false);
    }

    const dialogOptions = {
      properties: properties || [],
      filters: [{ name: "PDF Files", extensions: ["pdf"] }],
    };

    // Add platform-specific options for better compatibility
    if (process.platform === "win32") {
      dialogOptions.properties.push("noResolveAliases");
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(parentWindow, dialogOptions);

    if (canceled || !filePaths || filePaths.length === 0) {
      return [];
    }

    if (properties.includes("openDirectory")) {
      const dirPath = filePaths[0];
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const pdfPaths = entries
          .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
          .map((e) => join(dirPath, e.name));

        if (pdfPaths.length === 0) {
          throw new Error("No PDF files found in selected directory");
        }

        return Promise.all(
          pdfPaths.map(async (path) => {
            const stats = await fs.stat(path);
            return {
              path,
              name: basename(path),
              size: stats.size,
              id: Math.random(),
            };
          })
        );
      } catch (error) {
        console.error("Error reading directory:", error);
        throw new Error(`Failed to read directory: ${error.message}`);
      }
    }

    // Validate selected files exist and are readable
    const validFiles = [];
    for (const path of filePaths) {
      try {
        const stats = await fs.stat(path);
        if (stats.isFile()) {
          validFiles.push({
            path,
            name: basename(path),
            size: stats.size,
            id: Math.random(),
          });
        }
      } catch (error) {
        console.warn(`Skipping inaccessible file: ${path}`, error.message);
      }
    }

    if (validFiles.length === 0) {
      throw new Error("No valid PDF files selected");
    }

    return validFiles;
  } catch (error) {
    console.error("File selection error:", error);
    throw error; // This will be caught by the renderer and displayed as an error
  }
}

ipcMain.handle("select-pdf-files", (event) =>
  handleFileSelection(event, ["openFile", "multiSelections"])
);
ipcMain.handle("select-pdf-folder", (event) => handleFileSelection(event, ["openDirectory"]));
ipcMain.handle("select-output-directory", async (event) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) return null;

  try {
    // Ensure window is focused before showing dialog (fixes Windows 11 issues)
    if (process.platform === "win32") {
      parentWindow.setAlwaysOnTop(true);
      parentWindow.focus();
      parentWindow.setAlwaysOnTop(false);
    }

    const dialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      title: "Select Output Directory",
    };

    // Add platform-specific options for better compatibility
    if (process.platform === "win32") {
      dialogOptions.properties.push("noResolveAliases");
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(parentWindow, dialogOptions);

    if (canceled || !filePaths || filePaths.length === 0) {
      return null;
    }

    const selectedPath = filePaths[0];

    // Validate the selected directory exists and is writable
    try {
      const stats = await fs.stat(selectedPath);
      if (!stats.isDirectory()) {
        throw new Error("Selected path is not a directory");
      }

      // Test write permissions by trying to create a test file
      const testFile = join(selectedPath, ".write-test");
      await fs.writeFile(testFile, "test");
      await fs.unlink(testFile);

      return selectedPath;
    } catch (error) {
      console.error("Directory validation error:", error);
      throw new Error(`Selected directory is not accessible: ${error.message}`);
    }
  } catch (error) {
    console.error("Output directory selection error:", error);
    throw error;
  }
});

ipcMain.handle("convert-pdf", async (event, options) => {
  try {
    return {
      success: true,
      ...(await converter.convert(
        options.inputPath,
        options.outputPath,
        options.settings,
        (progressData) => {
          // Handle both old format (number) and new format (object)
          const progress = typeof progressData === "object" ? progressData.progress : progressData;
          const stage = typeof progressData === "object" ? progressData.stage : null;

          mainWindow?.webContents.send("conversion-progress", {
            file: options.inputPath,
            progress,
            stage,
          });
        }
      )),
    };
  } catch (error) {
    console.error("Conversion error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-settings", () => ({
  outputDirectory: store.get("outputDirectory", app.getPath("downloads")),
  outputFormat: store.get("outputFormat", "epub"),
  imageQuality: store.get("imageQuality", 85),
  imageMaxWidth: store.get("imageMaxWidth", 1200),
  preserveAnnotations: store.get("preserveAnnotations", true),
  optimizeForKindle: store.get("optimizeForKindle", true),
  includeMetadata: store.get("includeMetadata", true),
  autoSendToKindle: store.get("autoSendToKindle", false),
  kindleEmail: store.get("kindleEmail", ""),
  compressionLevel: store.get("compressionLevel", "balanced"),
  // Advanced settings
  enableOCR: store.get("enableOCR", false),
  ocrLanguages: store.get("ocrLanguages", ["eng"]),
  autoDetectScanned: store.get("autoDetectScanned", true),
  processingPriority: store.get("processingPriority", "normal"),
  maxFileSize: store.get("maxFileSize", 650),
  defaultOcrLanguages: store.get("defaultOcrLanguages", ["eng"]),
  defaultProcessingPriority: store.get("defaultProcessingPriority", "normal"),
}));
ipcMain.handle("save-settings", (event, settings) => {
  Object.entries(settings).forEach(([key, value]) => store.set(key, value));
});

ipcMain.handle("open-file-location", (event, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle("get-app-info", () => ({
  version: app.getVersion(),
  name: app.getName(),
}));

// Kindle IPC
ipcMain.handle("kindle-get-devices", () => kindleDetector.getConnectedDevices());
ipcMain.handle("kindle-copy-file", (e, { serial, sourcePath }) =>
  kindleDetector.copyToKindle(serial, sourcePath)
);
ipcMain.handle("kindle-eject-device", (e, serial) => kindleDetector.ejectDevice(serial));

// Window controls
ipcMain.handle("window-minimize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.minimize();
  }
});

ipcMain.handle("window-maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  }
});

ipcMain.handle("window-close", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.close();
  }
});

// App Lifecycle
app.whenReady().then(() => {
  createWindow();
  createMenu();
});

let isQuitting = false;
app.on("before-quit", async (event) => {
  if (isQuitting) {
    return;
  }
  event.preventDefault(); // Prevent the app from quitting immediately
  isQuitting = true;

  console.log("Cleaning up resources before quitting...");

  try {
    // Stop synchronous services first
    kindleDetector.stopMonitoring();
    // Await asynchronous services
    await ocrProcessor.terminate();
    console.log("All resources cleaned up successfully.");
  } catch (error) {
    console.error("Error during pre-quit cleanup:", error);
  } finally {
    app.quit(); // Now, quit the app
  }
});

app.on("window-all-closed", () => {
  // Quit the app when all windows are closed on all platforms
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
