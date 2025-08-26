// Kompres - Renderer Process

// State management
const state = {
  files: [],
  converting: false,
  settings: {},
  conversionResults: [],
  startTime: null,
};

// DOM Elements
const elements = {
  dropZone: null,
  fileListContainer: null,
  fileList: null,
  conversionOptions: null,
  progressArea: null,
  progressList: null,
  resultsArea: null,
  resultsList: null,
  settingsModal: null,
  aboutModal: null,
  toastContainer: null,
};

// Initialize the application
document.addEventListener("DOMContentLoaded", async () => {
  if (!window.electronAPI) {
    console.error("electronAPI is not available! This may indicate a preload script error.");
  }

  initializeElements();
  setupEventListeners();
  setupPlatformSpecificFeatures();
  await loadSettings();
  setupMenuListeners();
  requestNotificationPermission();
});

// Simple path utilities for renderer (no Node.js dependencies)
window.pathUtils = {
  basename: (path) => {
    return path.split("/").pop() || path.split("\\").pop() || path;
  },
  dirname: (path) => {
    const parts = path.split("/");
    if (parts.length === 1) {
      const winParts = path.split("\\");
      return winParts.length === 1 ? "." : winParts.slice(0, -1).join("\\");
    }
    return parts.length === 1 ? "." : parts.slice(0, -1).join("/");
  },
  extname: (path) => {
    const basename = window.pathUtils.basename(path);
    const lastDot = basename.lastIndexOf(".");
    return lastDot === -1 ? "" : basename.substring(lastDot);
  },
  join: (...paths) => {
    return paths.filter((p) => p && p.length > 0).join("/");
  },
};

// Initialize DOM element references
function initializeElements() {
  elements.dropZone = document.getElementById("drop-zone");
  elements.fileListContainer = document.getElementById("file-list-container");
  elements.fileList = document.getElementById("file-list");
  elements.conversionOptions = document.getElementById("conversion-options");
  elements.progressArea = document.getElementById("progress-area");
  elements.progressList = document.getElementById("progress-list");
  elements.resultsArea = document.getElementById("results-area");
  elements.resultsList = document.getElementById("results-list");
  elements.settingsModal = document.getElementById("settings-modal");
  elements.aboutModal = document.getElementById("about-modal");
  elements.toastContainer = document.getElementById("toast-container");
}

// Setup event listeners
function setupEventListeners() {
  // Drop zone
  elements.dropZone.addEventListener("click", handleDropZoneClick);
  elements.dropZone.addEventListener("dragover", handleDragOver);
  elements.dropZone.addEventListener("dragleave", handleDragLeave);
  elements.dropZone.addEventListener("drop", handleDrop);

  // File selection buttons
  document.getElementById("browse-files")?.addEventListener("click", selectFiles);
  document.getElementById("browse-folder")?.addEventListener("click", selectFolder);

  // File list actions
  document.getElementById("clear-all")?.addEventListener("click", clearAllFiles);
  document.getElementById("add-more")?.addEventListener("click", selectFiles);

  // Conversion
  document.getElementById("convert-btn")?.addEventListener("click", startConversion);
  document.getElementById("cancel-conversion")?.addEventListener("click", cancelConversion);
  document.getElementById("new-conversion")?.addEventListener("click", resetToStart);

  // Settings
  document
    .getElementById("settings-btn")
    ?.addEventListener("click", () => openModal("settings-modal"));
  document.getElementById("about-btn")?.addEventListener("click", () => openModal("about-modal"));
  document.getElementById("save-settings")?.addEventListener("click", saveSettings);
  document.getElementById("reset-settings")?.addEventListener("click", resetSettings);
  document.getElementById("change-output-dir")?.addEventListener("click", changeOutputDirectory);
  document
    .getElementById("change-default-output")
    ?.addEventListener("click", changeDefaultOutputDirectory);

  // Modal close buttons
  document.querySelectorAll(".modal-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const modalId = e.currentTarget.dataset.modal;
      closeModal(modalId);
    });
  });

  // Range sliders
  document.getElementById("image-quality")?.addEventListener("input", (e) => {
    document.getElementById("quality-value").textContent = e.target.value;
  });

  document.getElementById("default-quality")?.addEventListener("input", (e) => {
    document.getElementById("default-quality-value").textContent = e.target.value + "%";
  });

  // OCR toggle
  document.getElementById("enable-ocr")?.addEventListener("change", (e) => {
    const ocrContainer = document.getElementById("ocr-language-container");
    if (ocrContainer) {
      ocrContainer.style.display = e.target.checked ? "block" : "none";
    }
  });

  // Compression level
  // document
  //   .getElementById("compression-level")
  //   ?.addEventListener("change", updateCompressionPreview);

  // Output format selection
  document.getElementById("output-format")?.addEventListener("change", updateConvertButtonText);
  document.getElementById("default-format")?.addEventListener("change", (e) => {
    // Update the main conversion format to match default when changed
    const mainFormat = document.getElementById("output-format");
    if (mainFormat) {
      mainFormat.value = e.target.value;
      updateConvertButtonText();
    }
  });

  // Preset selection
  document.getElementById("conversion-preset")?.addEventListener("change", applyPreset);

  // Prevent default drag behavior on window
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  // Window controls (for Windows/Linux only)
  const isMacOS = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  if (!isMacOS && window.electronAPI) {
    document.getElementById("minimize-btn")?.addEventListener("click", () => {
      window.electronAPI.minimizeWindow?.();
    });

    document.getElementById("maximize-btn")?.addEventListener("click", () => {
      window.electronAPI.maximizeWindow?.();
    });

    document.getElementById("close-btn")?.addEventListener("click", () => {
      window.electronAPI.closeWindow?.();
    });
  }
}

// Setup platform-specific features
function setupPlatformSpecificFeatures() {
  // Show window controls on Windows/Linux, hide on macOS
  const windowControls = document.getElementById("window-controls");
  if (windowControls && window.electronAPI) {
    // Only show custom window controls on Windows and Linux
    // macOS uses native window controls in the title bar
    const isWindows = navigator.platform.toUpperCase().indexOf("WIN") >= 0;
    const isLinux = navigator.platform.toUpperCase().indexOf("LINUX") >= 0;

    // Show custom controls only on Windows and Linux
    if (isWindows || isLinux) {
      windowControls.style.display = "flex";
    }
    // On macOS, keep controls hidden (display: none by default)
  }
}

// Setup menu listeners
function setupMenuListeners() {
  if (!window.electronAPI) return;
  window.electronAPI.onMenuAction("open-file", selectFiles);
  window.electronAPI.onMenuAction("open-folder", selectFolder);
  window.electronAPI.onMenuAction("settings", () => openModal("settings-modal"));
  window.electronAPI.onMenuAction("about", () => openModal("about-modal"));

  window.electronAPI.onFileOpened((filePath) => {
    handleExternalFile(filePath);
  });

  // Window event listeners
  window.electronAPI.onWindowFocusChanged((focused) => {
    document.body.classList.toggle("window-focused", focused);
  });

  window.electronAPI.onWindowMinimized(() => {
    showToast("Window minimized", "Application minimized to tray", "info");
  });

  window.electronAPI.onWindowRestored(() => {
    showToast("Window restored", "Application window restored", "info");
  });
}

// Drop zone handlers
function handleDropZoneClick(e) {
  if (e.target.closest("#browse-files") || e.target.closest("#browse-folder")) {
    return;
  }
  selectFiles();
}

function handleDragOver(e) {
  e.preventDefault();
  elements.dropZone.classList.add("drag-over");

  // Add visual feedback for valid files
  const files = Array.from(e.dataTransfer.items);
  const hasValidFiles = files.some((item) => {
    if (item.kind === "file") {
      const file = item.getAsFile();
      return file && (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf");
    }
    return false;
  });

  if (hasValidFiles) {
    elements.dropZone.classList.add("drag-valid");
    showDragFeedback("Drop PDF files here", "valid");
  } else {
    elements.dropZone.classList.add("drag-invalid");
    showDragFeedback("Only PDF files are supported", "invalid");
  }
}

function handleDragLeave(e) {
  e.preventDefault();

  // Only remove drag-over if we're actually leaving the drop zone
  const rect = elements.dropZone.getBoundingClientRect();
  const x = e.clientX;
  const y = e.clientY;

  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    elements.dropZone.classList.remove("drag-over", "drag-valid", "drag-invalid");
    hideDragFeedback();
  }
}

async function handleDrop(e) {
  e.preventDefault();
  elements.dropZone.classList.remove("drag-over", "drag-valid", "drag-invalid");
  hideDragFeedback();

  try {
  const files = Array.from(e.dataTransfer.files);
    const pdfFiles = files.filter(
      (file) => file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf"
  );

  if (pdfFiles.length === 0) {
      showToast(
        "No PDF files found",
        "Please drop PDF files only. Other file types are not supported.",
        "warning"
      );
    return;
  }

    let addedCount = 0;
    let skippedCount = 0;
    const maxFileSize = 1024 * 1024 * 1024; // 1GB limit for individual files (increased for large documents)

  for (const file of pdfFiles) {
      // Check file size with more informative messaging
      if (file.size > maxFileSize) {
        showToast(
          "File too large",
          `${file.name} is ${(file.size / (1024 * 1024 * 1024)).toFixed(2)}GB. Maximum supported size is 1GB.`,
          "warning"
        );
        skippedCount++;
        continue;
      }

      // Warn about very large files but still allow them
      if (file.size > 500 * 1024 * 1024) {
        // 500MB
        showToast(
          "Large file detected",
          `${file.name} is ${(file.size / (1024 * 1024 * 1024)).toFixed(2)}GB. Consider using 'Maximum Compression' for faster syncing.`,
          "info"
        );
      }

      // Check if file already exists in the list
      const existingFile = state.files.find((f) => f.path === file.path);
      if (existingFile) {
        showToast("File already added", `${file.name} is already in the list`, "info");
        skippedCount++;
        continue;
      }

    addFileToList({
      path: file.path,
      name: file.name,
      size: file.size,
      id: Date.now() + Math.random(),
    });
      addedCount++;
  }

  updateUI();

    // Show summary message
    if (addedCount > 0) {
      let message = `Successfully added ${addedCount} PDF file${addedCount > 1 ? "s" : ""}`;
      if (skippedCount > 0) {
        message += ` (${skippedCount} skipped)`;
      }
      showToast("Files added", message, "success");
    } else if (skippedCount > 0) {
      showToast(
        "No files added",
        `${skippedCount} file${skippedCount > 1 ? "s were" : " was"} skipped`,
        "warning"
      );
    }
  } catch (error) {
    console.error("Drop handling error:", error);
    showToast("Drop failed", "An error occurred while processing the dropped files", "error");
  }
}

// Drag feedback functions
function showDragFeedback(message, type) {
  // Remove existing feedback
  hideDragFeedback();

  const feedback = document.createElement("div");
  feedback.className = `drag-feedback drag-${type}`;
  feedback.innerHTML = `
    <div class="drag-feedback-content">
      <span class="drag-feedback-icon">
        ${type === "valid" ? "✓" : "✗"}
      </span>
      <span class="drag-feedback-text">${message}</span>
    </div>
  `;

  elements.dropZone.appendChild(feedback);

  // Auto-hide after a delay
  setTimeout(() => {
    if (feedback.parentNode) {
      feedback.style.opacity = "0";
      setTimeout(() => feedback.remove(), 200);
    }
  }, 2000);
}

function hideDragFeedback() {
  const feedback = elements.dropZone.querySelector(".drag-feedback");
  if (feedback) {
    feedback.remove();
  }
}

// File selection
async function selectFiles() {
  if (!window.electronAPI) {
    console.error("electronAPI not available when trying to select files");
    showToast(
      "Application Error",
      "The application API is not available. Please restart the application.",
      "error"
    );
    return;
  }

  try {
  const files = await window.electronAPI.selectPDFFiles();
  if (files && files.length > 0) {
    files.forEach((file) => addFileToList(file));
    updateUI();
      showToast("Files selected", `${files.length} PDF file(s) added successfully`, "success");
    }
  } catch (error) {
    console.error("File selection error:", error);
    showToast("File Selection Failed", error.message || "Failed to select PDF files", "error");
  }
}

async function selectFolder() {
  if (!window.electronAPI) {
    showToast("Error", "Application API not available", "error");
    return;
  }

  try {
  const files = await window.electronAPI.selectPDFFolder();
  if (files && files.length > 0) {
    files.forEach((file) => addFileToList(file));
    updateUI();
      showToast("Folder processed", `${files.length} PDF file(s) found and added`, "success");
  } else {
      showToast("No PDF files found", "The selected folder contains no PDF files", "info");
    }
  } catch (error) {
    console.error("Folder selection error:", error);
    showToast(
      "Folder Selection Failed",
      error.message || "Failed to process selected folder",
      "error"
    );
  }
}

// File list management
function addFileToList(file) {
  // Check if file already exists
  if (state.files.find((f) => f.path === file.path)) {
    showToast("File already added", `${file.name} is already in the list`, "info");
    return;
  }

  state.files.push(file);
  renderFileList();
}

window.removeFile = function (fileId) {
  state.files = state.files.filter((f) => f.id !== fileId);
  renderFileList();
  updateUI();
};

function clearAllFiles() {
  state.files = [];
  renderFileList();
  updateUI();
}

function renderFileList() {
  elements.fileList.innerHTML = "";

  state.files.forEach((file) => {
    const fileItem = document.createElement("div");
    fileItem.className = "file-item";
    fileItem.innerHTML = `
      <div class="file-icon">
        <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
        </svg>
      </div>
      <div class="file-info">
        <div class="file-name" title="${file.name}">${file.name}</div>
        <div class="file-size">${window.electronAPI ? window.electronAPI.formatFileSize(file.size) : file.size}</div>
      </div>
      <div class="file-status">
        <button class="file-remove" onclick="window.removeFile(${file.id})">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;
    elements.fileList.appendChild(fileItem);
  });

  updateFileStats();
}

function updateFileStats() {
  const totalFiles = state.files.length;
  const totalSize = state.files.reduce((sum, file) => sum + file.size, 0);

  document.getElementById("total-files").textContent =
    `${totalFiles} ${totalFiles === 1 ? "file" : "files"} selected`;
  document.getElementById("total-size").textContent =
    `${window.electronAPI ? window.electronAPI.formatFileSize(totalSize) : totalSize} total`;
}

// UI updates
function updateUI() {
  const hasFiles = state.files.length > 0;

  elements.dropZone.classList.toggle("hidden", hasFiles);
  elements.fileListContainer.classList.toggle("hidden", !hasFiles);
  elements.conversionOptions.classList.toggle("hidden", !hasFiles);
  elements.progressArea.classList.add("hidden");
  elements.resultsArea.classList.add("hidden");
}

function resetToStart() {
  state.files = [];
  state.conversionResults = [];
  renderFileList();
  updateUI();
}

// Conversion
async function startConversion() {
  if (state.files.length === 0) return;

  state.converting = true;
  state.conversionResults = [];
  state.startTime = Date.now();

  // Get settings
  const settings = {
    imageQuality: parseInt(document.getElementById("image-quality").value),
    compressionLevel: document.getElementById("compression-level").value,
    optimizeForKindle: document.getElementById("optimize-kindle")?.checked,
    preserveAnnotations: document.getElementById("preserve-annotations")?.checked,
    grayscale: document.getElementById("grayscale")?.checked,
    outputDirectory: document.getElementById("output-dir").value,
    outputFormat: document.getElementById("output-format").value,
    // Advanced options
    enableOCR: document.getElementById("enable-ocr")?.checked || false,
    ocrLanguages: Array.from(document.getElementById("ocr-language")?.selectedOptions || []).map(
      (option) => option.value
    ) || ["eng"],
    autoDetectScanned: document.getElementById("auto-detect-scanned")?.checked !== false,
    processingPriority: document.getElementById("processing-priority")?.value || "normal",
    maxFileSize: parseInt(document.getElementById("max-file-size")?.value) || 650,
    // Batch processing options
    concurrentJobs: parseInt(document.getElementById("concurrent-jobs")?.value) || 2,
    skipExisting: document.getElementById("skip-existing")?.checked || false,
    continueOnError: document.getElementById("continue-on-error")?.checked !== false,
    batchDelay: parseInt(document.getElementById("batch-delay")?.value) || 1000,
    // Sync optimization options
    optimizeForSync: document.getElementById("optimize-for-sync")?.checked || false,
    syncTargetSize: document.getElementById("sync-target-size")?.value || "auto",
    progressiveLoading: document.getElementById("progressive-loading")?.checked !== false,
    memoryOptimization: document.getElementById("memory-optimization")?.value || "auto",
  };

  // Hide options, show progress
  elements.conversionOptions.classList.add("hidden");
  elements.fileListContainer.classList.add("hidden");
  elements.progressArea.classList.remove("hidden");

  // Setup progress UI
  setupProgressUI();

  // Convert files with batch processing
  await convertFilesBatch(state.files, settings);

  // Show results
  showResults();
}

function setupProgressUI() {
  elements.progressList.innerHTML = "";

  state.files.forEach((file) => {
    const progressItem = document.createElement("div");
    progressItem.className = "progress-item";
    progressItem.id = `progress-${file.id}`;
    progressItem.innerHTML = `
      <div class="progress-item-info">
        <div class="progress-item-name">${file.name}</div>
        <div class="progress-item-details">
          <span class="file-size">${window.electronAPI ? window.electronAPI.formatFileSize(file.size) : file.size}</span>
          <span class="progress-stage">Preparing...</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: 0%"></div>
        </div>
      </div>
      <div class="progress-status">
        <span class="progress-percentage">0%</span>
        <span class="progress-time">--:--</span>
      </div>
    `;
    elements.progressList.appendChild(progressItem);
  });

  document.getElementById("progress-current").textContent = "0";
  document.getElementById("progress-total").textContent = state.files.length.toString();

  // Update overall progress info
  updateProgressSummary(0);
}

function updateProgressItem(itemId, percentage, status, stage = null) {
  const item = document.getElementById(itemId);
  if (!item) return;

  const progressBar = item.querySelector(".progress-bar");
  const progressStatus = item.querySelector(".progress-status");
  const progressPercentage = item.querySelector(".progress-percentage");
  const progressStage = item.querySelector(".progress-stage");
  const progressTime = item.querySelector(".progress-time");

  // Update progress bar
  progressBar.style.width = `${percentage}%`;

  // Update stage information if provided
  if (stage && progressStage) {
    progressStage.textContent = stage;
  }

  // Update status display
  if (status === "Complete") {
    progressStatus.innerHTML = `
      <svg width="20" height="20" fill="green" viewBox="0 0 24 24">
        <path d="M9,16.17L4.83,12l-1.42,1.41L9,19 21,7l-1.41-1.41L9,16.17z"/>
      </svg>
    `;
    if (progressStage) progressStage.textContent = "Complete";
    if (progressPercentage) progressPercentage.textContent = "100%";
  } else if (status === "Failed") {
    progressStatus.innerHTML = `
      <button class="retry-btn" onclick="retryConversion('${itemId.replace("progress-", "")}')" title="Retry conversion">
        <svg width="16" height="16" fill="red" viewBox="0 0 24 24">
          <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
        </svg>
      </button>
    `;
    if (progressStage) progressStage.textContent = "Failed";
    if (progressPercentage) progressPercentage.textContent = "Error";
    item.classList.add("error");
  } else {
    if (progressPercentage) progressPercentage.textContent = `${percentage}%`;
    if (progressTime) {
      // Estimate remaining time (simple implementation)
      const elapsed = Date.now() - state.startTime;
      if (percentage > 0 && elapsed > 5000) {
        // Only show after 5 seconds and some progress
        const totalEstimated = (elapsed / percentage) * 100;
        const remaining = Math.max(0, totalEstimated - elapsed);
        progressTime.textContent = formatTime(remaining);
      }
    }
  }
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  } else {
    return `0:${remainingSeconds.toString().padStart(2, "0")}`;
  }
}

// Retry conversion function
window.retryConversion = async function (fileId) {
  const file = state.files.find((f) => f.id === fileId);
  if (!file) return;

  // Reset progress item
  const progressItem = document.getElementById(`progress-${fileId}`);
  if (progressItem) {
    progressItem.classList.remove("error");
    updateProgressItem(`progress-${fileId}`, 0, "Preparing...", "Retrying...");
  }

  // Remove from conversion results if it was there
  state.conversionResults = state.conversionResults.filter((r) => r.id !== fileId);

  try {
    const settings = {
      imageQuality: parseInt(document.getElementById("image-quality").value),
      compressionLevel: document.getElementById("compression-level").value,
      optimizeForKindle: document.getElementById("optimize-kindle")?.checked,
      preserveAnnotations: document.getElementById("preserve-annotations")?.checked,
      grayscale: document.getElementById("grayscale")?.checked,
      outputDirectory: document.getElementById("output-dir").value,
      outputFormat: document.getElementById("output-format").value,
      enableOCR: document.getElementById("enable-ocr")?.checked || false,
      ocrLanguages: Array.from(document.getElementById("ocr-language")?.selectedOptions || []).map(
        (option) => option.value
      ) || ["eng"],
      autoDetectScanned: document.getElementById("auto-detect-scanned")?.checked !== false,
      processingPriority: document.getElementById("processing-priority")?.value || "normal",
      maxFileSize: parseInt(document.getElementById("max-file-size")?.value) || 650,
    };

    const result = await window.electronAPI.convertPDF({
      inputPath: file.path,
      outputPath: null,
      settings: settings,
    });

    if (result.success) {
      state.conversionResults.push({
        ...file,
        success: true,
        outputPath: result.outputPath,
        outputSize: result.outputSize,
        compressionRatio: result.compressionRatio,
      });
      updateProgressItem(`progress-${fileId}`, 100, "Complete");
      showToast("Retry successful", `${file.name} converted successfully`, "success");
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
      state.conversionResults.push({
        ...file,
        success: false,
      error: error.message,
    });
    updateProgressItem(`progress-${fileId}`, 100, "Failed");
    showToast("Retry failed", `Failed to convert ${file.name}: ${error.message}`, "error");
  }

  // Update overall progress
  const completedCount = state.conversionResults.length;
  document.getElementById("progress-current").textContent = completedCount.toString();
};

// Batch conversion with concurrent processing
async function convertFilesBatch(files, settings) {
  const {
    concurrentJobs = 2,
    skipExisting = false,
    continueOnError = true,
    batchDelay = 1000,
  } = settings;

  const results = [];
  const activePromises = new Map();
  let fileIndex = 0;

  // Function to start a new conversion job
  const startConversionJob = async (file, index) => {
    const jobId = `job-${index}`;

    try {
      // Check if file already exists and should be skipped
      if (skipExisting) {
        const outputPath = await checkExistingFile(file, settings);
        if (outputPath) {
          results.push({
            ...file,
            success: true,
            outputPath: outputPath,
            skipped: true,
            compressionRatio: 0,
          });
          updateProgressItem(`progress-${file.id}`, 100, "Complete", "Skipped (existing)");
          return;
        }
      }

      const result = await window.electronAPI.convertPDF({
        inputPath: file.path,
        outputPath: null,
        settings: { ...settings, concurrentJobs: 1 }, // Single job for individual conversion
      });

      if (result.success) {
        results.push({
          ...file,
          success: true,
          outputPath: result.outputPath,
          outputSize: result.outputSize,
          compressionRatio: result.compressionRatio,
        });
        updateProgressItem(`progress-${file.id}`, 100, "Complete");
      } else {
        throw new Error(result.error);
    }
  } catch (error) {
      results.push({
      ...file,
      success: false,
      error: error.message,
    });
      updateProgressItem(`progress-${file.id}`, 100, "Failed");

      if (!continueOnError) {
        state.converting = false;
        showToast("Batch conversion stopped", `Conversion failed for ${file.name}`, "error");
        return;
      }
    } finally {
      activePromises.delete(jobId);
    }
  };

  // Main batch processing loop
  while (fileIndex < files.length && state.converting) {
    // Start new jobs up to the concurrent limit
    while (activePromises.size < concurrentJobs && fileIndex < files.length && state.converting) {
      const file = files[fileIndex];
      const jobPromise = startConversionJob(file, fileIndex);
      activePromises.set(`job-${fileIndex}`, jobPromise);
      fileIndex++;

      // Add delay between starting jobs
      if (batchDelay > 0 && fileIndex < files.length) {
        await new Promise((resolve) => setTimeout(resolve, batchDelay));
      }
    }

    // Wait for at least one job to complete before starting more
    if (activePromises.size > 0) {
      await Promise.race(activePromises.values());
    }
  }

  // Wait for all remaining jobs to complete
  if (activePromises.size > 0) {
    await Promise.allSettled(activePromises.values());
  }

  // Update state with results
  state.conversionResults = results;
}

// Check if output file already exists
async function checkExistingFile(file, settings) {
  try {
    const outputDir = settings.outputDirectory;
    const outputFormat = settings.outputFormat;
    const baseName = file.name.replace(/\.pdf$/i, "");
    const outputFileName = `${baseName}.${outputFormat}`;
    // eslint-disable-next-line no-unused-vars
    const outputPath = window.pathUtils.join(outputDir, outputFileName);

    // Check if file exists (this is a simple check, in a real app you'd use fs.stat)
    // For now, we'll just return null to indicate file doesn't exist
    // In a production app, you'd implement proper file existence checking
    return null;
  } catch (error) {
    console.warn("Error checking existing file:", error);
    return null;
  }
}

function updateProgressSummary(completed) {
  document.getElementById("progress-current").textContent = completed.toString();
}

function cancelConversion() {
  state.converting = false;
  showToast("Conversion cancelled", "The conversion process has been stopped", "info");
  showResults();
}

// Conversion progress handler
if (window.electronAPI) {
  window.electronAPI.onConversionProgress((data) => {
    const file = state.files.find((f) => f.path === data.file);
    if (file) {
      let stage = "Converting...";
      if (data.stage) {
        stage = data.stage;
      } else if (data.progress < 20) {
        stage = "Loading PDF...";
      } else if (data.progress < 40) {
        stage = "Extracting pages...";
      } else if (data.progress < 70) {
        stage = "Processing images...";
      } else if (data.progress < 90) {
        stage = "Generating e-book...";
      } else {
        stage = "Finalizing...";
      }

      updateProgressItem(`progress-${file.id}`, data.progress, "Converting...", stage);
    }
  });
}

// Results
function showResults() {
  state.converting = false;
  const endTime = Date.now();
  const duration = Math.round((endTime - state.startTime) / 1000);

  elements.progressArea.classList.add("hidden");
  elements.resultsArea.classList.remove("hidden");

  renderResults();
  updateResultsSummary(duration);

  // Send notification
  const successCount = state.conversionResults.filter((r) => r.success).length;
  const totalCount = state.conversionResults.length;

  if (window.electronAPI) {
    window.electronAPI.showNotification(
      "Conversion Complete",
      `${successCount} of ${totalCount} files converted successfully`
    );
  }
}

function renderResults() {
  elements.resultsList.innerHTML = "";

  state.conversionResults.forEach((result) => {
    const resultItem = document.createElement("div");
    resultItem.className = `result-item ${result.success ? "" : "error"}`;

    if (result.success) {
      resultItem.innerHTML = `
        <div class="result-icon success">
          <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
            <path d="M9,16.17L4.83,12l-1.42,1.41L9,19 21,7l-1.41-1.41L9,16.17z"/>
          </svg>
        </div>
        <div class="result-info">
          <div class="result-name">${result.name}</div>
          <div class="result-details">
            Size reduced by ${result.compressionRatio}% • ${window.electronAPI ? window.electronAPI.formatFileSize(result.outputSize) : result.outputSize}
          </div>
        </div>
        <div class="result-actions">
          <button class="btn btn-secondary" onclick="window.openFileLocation('${result.outputPath.replace(/\\/g, "\\\\")}')">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
            Show File
          </button>
          ${
            state.settings.autoSendToKindle
              ? `
            <button class="btn btn-secondary" onclick="window.sendToKindle('${result.outputPath.replace(/\\/g, "\\\\")}')">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12,1L8,5H11V14H13V5H16M18,23H6C4.89,23 4,22.1 4,21V9A2,2 0 0,1 6,7H9V9H6V21H18V9H15V7H18A2,2 0 0,1 20,9V21A2,2 0 0,1 18,23Z"/>
              </svg>
              Send to Kindle
            </button>
          `
              : ""
          }
        </div>
      `;
    } else {
      resultItem.innerHTML = `
        <div class="result-icon error">
          <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
          </svg>
        </div>
        <div class="result-info">
          <div class="result-name">${result.name}</div>
          <div class="result-details">Error: ${result.error}</div>
        </div>
      `;
    }

    elements.resultsList.appendChild(resultItem);
  });
}

function updateResultsSummary(duration) {
  const totalConverted = state.conversionResults.filter((r) => r.success).length;
  const initialSize = state.conversionResults.reduce((sum, r) => sum + (r.size || 0), 0);
  const finalSize = state.conversionResults.reduce((sum, r) => sum + (r.outputSize || 0), 0);
  const reduction = initialSize > 0 ? ((1 - finalSize / initialSize) * 100).toFixed(1) : 0;

  document.getElementById("total-converted").textContent = totalConverted;
  document.getElementById("size-reduction").textContent = `${reduction}%`;
  document.getElementById("time-taken").textContent = `${duration}s`;
}

window.openFileLocation = async function (filePath) {
  if (window.electronAPI) {
    await window.electronAPI.openFileLocation(filePath);
  }
};

window.sendToKindle = async function (filePath) {
  const kindleEmail = state.settings.kindleEmail;
  if (!kindleEmail) {
    showToast("Kindle email not set", "Please configure your Kindle email in settings", "warning");
    openModal("settings-modal");
    return;
  }

  if (!window.electronAPI) {
    showToast("Send failed", "electronAPI API not available", "error");
    return;
  }

  const result = await window.electronAPI.sendToKindle({
    filePath: filePath,
    kindleEmail: kindleEmail,
  });

  if (result.success) {
    showToast("Sent to Kindle", "File has been sent to your Kindle device", "success");
  } else {
    showToast("Send failed", result.error || "Failed to send file to Kindle", "error");
  }
};

// Settings
async function loadSettings() {
  if (!window.electronAPI) return;
  state.settings = await window.electronAPI.getSettings();
  applySettings();
}

function applySettings() {
  // Main UI
  document.getElementById("output-dir").value = state.settings.outputDirectory || "";
  document.getElementById("image-quality").value = state.settings.imageQuality || 85;
  document.getElementById("quality-value").textContent = state.settings.imageQuality || 85;
  document.getElementById("compression-level").value =
    state.settings.compressionLevel || "balanced";
  document.getElementById("optimize-kindle").checked = state.settings.optimizeForKindle !== false;
  document.getElementById("preserve-annotations").checked =
    state.settings.preserveAnnotations !== false;
  document.getElementById("output-format").value = state.settings.outputFormat || "epub";

  // Advanced options
  document.getElementById("enable-ocr").checked = state.settings.enableOCR || false;
  document.getElementById("auto-detect-scanned").checked =
    state.settings.autoDetectScanned !== false;
  document.getElementById("processing-priority").value =
    state.settings.processingPriority || "normal";
  document.getElementById("max-file-size").value = state.settings.maxFileSize || 650;

  // OCR languages
  const ocrSelect = document.getElementById("ocr-language");
  if (ocrSelect && state.settings.ocrLanguages) {
    Array.from(ocrSelect.options).forEach((option) => {
      option.selected = state.settings.ocrLanguages.includes(option.value);
    });
  }

  // Update OCR container visibility
  const ocrContainer = document.getElementById("ocr-language-container");
  if (ocrContainer) {
    ocrContainer.style.display = state.settings.enableOCR || false ? "block" : "none";
  }

  // Settings modal
  document.getElementById("default-output").value = state.settings.outputDirectory || "";
  document.getElementById("default-quality").value = state.settings.imageQuality || 85;
  document.getElementById("default-quality-value").textContent =
    (state.settings.imageQuality || 85) + "%";
  document.getElementById("max-width").value = state.settings.imageMaxWidth || 1200;
  document.getElementById("auto-send-kindle").checked = state.settings.autoSendToKindle || false;
  document.getElementById("kindle-email").value = state.settings.kindleEmail || "";
  document.getElementById("include-metadata").checked = state.settings.includeMetadata !== false;
  document.getElementById("default-format").value = state.settings.outputFormat || "epub";

  // Default advanced settings
  const defaultOcrSelect = document.getElementById("default-ocr-language");
  if (defaultOcrSelect && state.settings.defaultOcrLanguages) {
    Array.from(defaultOcrSelect.options).forEach((option) => {
      option.selected = state.settings.defaultOcrLanguages.includes(option.value);
    });
  }
  document.getElementById("default-processing-priority").value =
    state.settings.defaultProcessingPriority || "normal";

  // Update convert button text
  updateConvertButtonText();
}

async function saveSettings() {
  if (!window.electronAPI) return;
  const newSettings = {
    outputDirectory: document.getElementById("default-output").value,
    outputFormat: document.getElementById("default-format").value,
    imageQuality: parseInt(document.getElementById("default-quality").value),
    imageMaxWidth: parseInt(document.getElementById("max-width").value),
    autoSendToKindle: document.getElementById("auto-send-kindle").checked,
    kindleEmail: document.getElementById("kindle-email").value,
    includeMetadata: document.getElementById("include-metadata").checked,
    // Default advanced settings
    defaultOcrLanguages: Array.from(
      document.getElementById("default-ocr-language")?.selectedOptions || []
    ).map((option) => option.value) || ["eng"],
    defaultProcessingPriority:
      document.getElementById("default-processing-priority")?.value || "normal",
  };

  await window.electronAPI.saveSettings(newSettings);
  state.settings = { ...state.settings, ...newSettings };
  applySettings();
  closeModal("settings-modal");
  showToast("Settings saved", "Your preferences have been updated", "success");
}

async function resetSettings() {
  if (!window.electronAPI) return;
  const defaultSettings = {
    outputFormat: "epub",
    imageQuality: 85,
    imageMaxWidth: 1200,
    preserveAnnotations: true,
    optimizeForKindle: true,
    includeMetadata: true,
    autoSendToKindle: false,
    kindleEmail: "",
    compressionLevel: "balanced",
    // Advanced defaults
    enableOCR: false,
    ocrLanguages: ["eng"],
    autoDetectScanned: true,
    processingPriority: "normal",
    maxFileSize: 650,
    defaultOcrLanguages: ["eng"],
    defaultProcessingPriority: "normal",
  };

  await window.electronAPI.saveSettings(defaultSettings);
  await loadSettings();
  showToast("Settings reset", "Settings have been reset to defaults", "info");
}

async function changeOutputDirectory() {
  if (!window.electronAPI) {
    showToast("Error", "Application API not available", "error");
    return;
  }

  try {
  const directory = await window.electronAPI.selectOutputDirectory();
  if (directory) {
    document.getElementById("output-dir").value = directory;
      showToast("Output directory updated", "New output location selected", "success");
    }
  } catch (error) {
    console.error("Output directory selection error:", error);
    showToast(
      "Directory Selection Failed",
      error.message || "Failed to select output directory",
      "error"
    );
  }
}

async function changeDefaultOutputDirectory() {
  if (!window.electronAPI) {
    showToast("Error", "Application API not available", "error");
    return;
  }

  try {
  const directory = await window.electronAPI.selectOutputDirectory();
  if (directory) {
    document.getElementById("default-output").value = directory;
      showToast("Default directory updated", "New default output location selected", "success");
    }
  } catch (error) {
    console.error("Default output directory selection error:", error);
    showToast(
      "Directory Selection Failed",
      error.message || "Failed to select default output directory",
      "error"
    );
  }
}

// function updateCompressionPreview() {
//   const level = document.getElementById("compression-level").value;
//   // Could show compression level description in a tooltip or small text element
//   // switch (level) {
//   //   case "minimum":
//   //     description = "Best quality, larger file size";
//   //   //   break;
//   //   case "balanced":
//   //     description = "Good quality, moderate file size";
//   //     break;
//   //   case "maximum":
//   //     description = "Smallest file size, reduced quality";
//   //     break;
//   // }
// }

// Preset configurations for different devices and use cases
const presets = {
  "kindle-scribe": {
    outputFormat: "epub",
    imageQuality: 90,
    imageMaxWidth: 1440,
    compressionLevel: "balanced",
    optimizeForKindle: true,
    preserveAnnotations: true,
    enableOCR: false,
    processingPriority: "normal",
    maxFileSize: 650,
  },
  "kindle-paperwhite": {
    outputFormat: "epub",
    imageQuality: 85,
    imageMaxWidth: 1236,
    compressionLevel: "balanced",
    optimizeForKindle: true,
    preserveAnnotations: true,
    enableOCR: false,
    processingPriority: "normal",
    maxFileSize: 650,
  },
  "kindle-oasis": {
    outputFormat: "epub",
    imageQuality: 95,
    imageMaxWidth: 1680,
    compressionLevel: "minimum",
    optimizeForKindle: true,
    preserveAnnotations: true,
    enableOCR: false,
    processingPriority: "normal",
    maxFileSize: 650,
  },
  "kindle-basic": {
    outputFormat: "mobi",
    imageQuality: 75,
    imageMaxWidth: 800,
    compressionLevel: "maximum",
    optimizeForKindle: true,
    preserveAnnotations: false,
    enableOCR: false,
    processingPriority: "normal",
    maxFileSize: 50,
  },
  "high-quality": {
    outputFormat: "epub",
    imageQuality: 95,
    imageMaxWidth: 2000,
    compressionLevel: "minimum",
    optimizeForKindle: true,
    preserveAnnotations: true,
    enableOCR: true,
    processingPriority: "high",
    maxFileSize: 650,
    optimizeForSync: false,
    syncTargetSize: "no-limit",
    progressiveLoading: true,
    memoryOptimization: "high-performance",
  },
  "small-size": {
    outputFormat: "mobi",
    imageQuality: 60,
    imageMaxWidth: 800,
    compressionLevel: "maximum",
    optimizeForKindle: true,
    preserveAnnotations: false,
    enableOCR: false,
    processingPriority: "low",
    maxFileSize: 50,
    optimizeForSync: true,
    syncTargetSize: "25",
    progressiveLoading: true,
    memoryOptimization: "low-memory",
  },
  "sync-optimized": {
    outputFormat: "epub",
    imageQuality: 70,
    imageMaxWidth: 1200,
    compressionLevel: "maximum",
    optimizeForKindle: true,
    preserveAnnotations: true,
    enableOCR: false,
    processingPriority: "normal",
    maxFileSize: 50,
    optimizeForSync: true,
    syncTargetSize: "25",
    progressiveLoading: true,
    memoryOptimization: "balanced",
  },
  balanced: {
    outputFormat: "epub",
    imageQuality: 85,
    imageMaxWidth: 1200,
    compressionLevel: "balanced",
    optimizeForKindle: true,
    preserveAnnotations: true,
    enableOCR: false,
    processingPriority: "normal",
    maxFileSize: 650,
    optimizeForSync: false,
    syncTargetSize: "auto",
    progressiveLoading: true,
    memoryOptimization: "balanced",
  },
};

function applyPreset(e) {
  const preset = e.target.value;
  if (preset === "custom") return;

  const config = presets[preset];
  if (!config) return;

  // Apply preset settings to the UI
  document.getElementById("output-format").value = config.outputFormat;
  document.getElementById("image-quality").value = config.imageQuality;
  document.getElementById("quality-value").textContent = config.imageQuality;
  document.getElementById("compression-level").value = config.compressionLevel;
  document.getElementById("optimize-kindle").checked = config.optimizeForKindle;
  document.getElementById("preserve-annotations").checked = config.preserveAnnotations;
  document.getElementById("enable-ocr").checked = config.enableOCR;
  document.getElementById("processing-priority").value = config.processingPriority;
  document.getElementById("max-file-size").value = config.maxFileSize;

  // Apply sync optimization settings
  document.getElementById("optimize-for-sync").checked = config.optimizeForSync || false;
  document.getElementById("sync-target-size").value = config.syncTargetSize || "auto";
  document.getElementById("progressive-loading").checked = config.progressiveLoading !== false;
  document.getElementById("memory-optimization").value = config.memoryOptimization || "auto";

  // Update OCR language visibility
  const ocrContainer = document.getElementById("ocr-language-container");
  if (ocrContainer) {
    ocrContainer.style.display = config.enableOCR ? "block" : "none";
  }

  // Update convert button text
  updateConvertButtonText();

  // Show confirmation
  showToast(
    "Preset Applied",
    `Settings optimized for ${e.target.options[e.target.selectedIndex].text}`,
    "success"
  );
}

function updateConvertButtonText() {
  const format = document.getElementById("output-format")?.value || "epub";
  const convertBtn = document.getElementById("convert-btn");
  if (convertBtn) {
    const formatNames = {
      epub: "EPUB",
      mobi: "MOBI",
      pdf: "PDF",
      azw3: "AZW3",
    };
    convertBtn.innerHTML = `
      <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
      </svg>
      Convert to ${formatNames[format] || "EPUB"}
    `;
  }
}

// Modal management
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("hidden");

    if (modalId === "about-modal") {
      loadAboutInfo();
    }
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("hidden");
  }
}

async function loadAboutInfo() {
  if (!window.electronAPI) return;
  const info = await window.electronAPI.getAppInfo();
  document.getElementById("app-version").textContent = info.version;
}

// Toast notifications
function showToast(title, message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icons = {
    success:
      '<svg width="20" height="20" fill="green" viewBox="0 0 24 24"><path d="M9,16.17L4.83,12l-1.42,1.41L9,19 21,7l-1.41-1.41L9,16.17z"/></svg>',
    error:
      '<svg width="20" height="20" fill="red" viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>',
    warning:
      '<svg width="20" height="20" fill="orange" viewBox="0 0 24 24"><path d="M12,2L1,21H23M12,6L19.53,19H4.47M11,10V14H13V10M11,16V18H13V16"/></svg>',
    info: '<svg width="20" height="20" fill="blue" viewBox="0 0 24 24"><path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z"/></svg>',
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  elements.toastContainer.appendChild(toast);

  // Auto remove after 5 seconds
  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease";
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 5000);
}

// External file handling
async function handleExternalFile(filePath) {
  if (!window.electronAPI) return;
  if (filePath.toLowerCase().endsWith(".pdf")) {
    const stats = { size: 0 }; // We can't get stats from renderer, main process should provide it.
    addFileToList({
      path: filePath,
      name: window.pathUtils.basename(filePath),
      size: stats.size, // This will be 0, but main process could be updated to send size.
      id: Date.now() + Math.random(),
    });
    updateUI();
  }
}

// Request notification permission
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// Add CSS animation for slideOut
const style = document.createElement("style");
style.textContent = `
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);
