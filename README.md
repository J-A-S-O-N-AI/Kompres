# Kompres 📚

> A powerful desktop application that converts PDF files to optimized EPUB format for Kindle devices, with special support for Kindle Scribe annotations.

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/J-A-S-O-N-AI/Kompres/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-orange.svg)](https://github.com/J-A-S-O-N-AI/Kompres/releases)
[![CI/CD](https://github.com/J-A-S-O-N-AI/Kompres/actions/workflows/release.yml/badge.svg)](https://github.com/J-A-S-O-N-AI/Kompres/actions/workflows/release.yml)

## ✨ Features

### 🚀 Core Features
-   **📱 Kindle Scribe Optimized**: Maintains annotation support for Kindle Scribe devices.
-   **🗜️ Smart Compression**: Reduces file sizes by up to 70% while preserving quality.
-   **📦 Batch Conversion**: Convert multiple PDFs simultaneously.
-   **🎯 Drag & Drop Interface**: Simple and intuitive user experience.
-   **⚙️ Advanced Settings**: Fine-tune output quality and compression levels.
-   **🌐 Cross-Platform**: Native support for macOS, Windows, and Linux.
-   **🔍 OCR Support**: Automatically detect and process scanned PDFs with text recognition.
-   **📲 Automatic Kindle Detection**: Detects connected Kindle devices and transfers files directly.

### 🛠️ Conversion Options
-   **🎨 Adjustable Image Quality**: 50-100% quality control.
-   **⚡ Three Compression Levels**: Minimum, Balanced, Maximum.
-   **⚫ Grayscale Conversion**: Further size reduction option.
-   **📐 Configurable Dimensions**: Set maximum image width.
-   **🏷️ Metadata Control**: Preserve or strip document metadata.
-   **🌍 OCR Languages**: 13+ language support for text recognition.
-   **🔍 Smart Detection**: Automatic scanned PDF detection.
-   **🔄 Sync Optimization**: Optimize files for faster device syncing.

## 📥 Installation

### Pre-built Binaries (Recommended)
Download the latest release from the [**GitHub Releases**](https://github.com/J-A-S-O-N-AI/Kompres/releases) page:

-   **macOS**: Download the `.dmg` file. Open it and drag `Kompres.app` to your Applications folder.
-   **Windows**: Download the `.exe` installer and run it.
-   **Linux**: Download the `.deb` package (for Debian/Ubuntu) or the portable `.AppImage` file.

### Build from Source
**Prerequisites:**
-   Node.js 20+
-   npm
-   Git

**Steps:**
1.  Clone the repository:
    ~~~bash
    git clone https://github.com/J-A-S-O-N-AI/Kompres.git
    cd Kompres
    ~~~
2.  Install dependencies:
    ~~~bash
    npm install
    ~~~
3.  Run the application in development mode:
    ~~~bash
    npm run dev
    ~~~

## 🚀 Usage

1.  **Launch** Kompres.
2.  **Add PDFs** by dragging and dropping them onto the window or using the "Select Files" button.
3.  **Configure** conversion settings in the main panel as needed.
4.  Click **"Start Conversion"** and wait for the process to complete.
5.  Find your converted files in the specified output directory.

## 🏗️ Building and Releasing

This project supports two primary methods for building and releasing the application: an automated process via GitHub Actions and a manual process using local scripts.

### 1. Automated Release (GitHub Actions - Recommended)

The preferred method for creating an official release is to use the automated workflow. This ensures consistent builds across all platforms.

**Process:**
1.  Ensure your local `main` branch is up-to-date and all changes are committed.
2.  Update the `version` in `package.json` according to [Semantic Versioning](https://semver.org/).
3.  Create and push a new git tag matching the version number:
    ~~~bash
    # Example for version 1.1.0
    git tag v1.1.0
    git push origin v1.1.0
    ~~~
4.  Pushing the tag will automatically trigger the **"Create Release"** workflow in GitHub Actions.
5.  The workflow will build the application for macOS, Windows, and Linux, create a new GitHub Release, and upload the compiled artifacts (`.dmg`, `.exe`, `.AppImage`, etc.) to it.

### 2. Manual Building (Local Scripts)

For local development, testing, or creating builds without making a formal release, you can use the provided npm scripts.

**Prerequisites:**
-   **Node.js 20+**, npm, Git
-   **macOS**: Xcode Command Line Tools (`xcode-select --install`)
-   **Windows**: Visual Studio Build Tools with C++ workload
-   **Linux**: `build-essential`, `libvips-dev`, `libgtk-3-dev` and other dependencies mentioned in `release.yml`.

**Build Commands:**
Use the `build:local:*` commands to prevent electron-builder from attempting to publish artifacts.
~~~bash
# Build for your current platform
npm run build:local

# Build specifically for macOS, Windows, or Linux
npm run build:local:mac
npm run build:local:win
npm run build:local:linux
~~~

### Cross-Platform Building with Parallels (macOS)

If you are on macOS and need to build the Windows version, you can use the `release.sh` script, which leverages Parallels Desktop.

**Setup:**
1.  Install Parallels Desktop and have a Windows VM named `Windows 11`.
2.  Configure Parallels Shared Folders to share **All Disks** from your Mac to the VM. This allows the build script to access the project files seamlessly.

**Command:**
This command will build for macOS and Linux locally, then use the Windows VM to build the Windows executable, and finally create a GitHub release with all artifacts.
~~~bash
./scripts/release.sh all
~~~

## 🔧 Configuration

Application settings are managed via `electron-store` and are accessible through the in-app settings modal. This includes default output directories, quality settings, and Kindle-specific options.

## 🐛 Troubleshooting

-   **App won't start**: Ensure you are using a compatible version of Node.js (20+). Try removing `node_modules` and running `npm install` again.
-   **Conversion fails**: Check the console for errors (`View > Toggle Developer Tools`). The issue may be with a specific PDF. Try a different file to confirm.
-   **Build errors**: Make sure you have installed the platform-specific build tools listed in the prerequisites. On Linux, dependency issues are common; ensure all required libraries are installed.

## 🤝 Contributing

Contributions are welcome! Please follow these steps:
1.  Fork the repository.
2.  Create a new branch for your feature or bug fix.
3.  Install dependencies with `npm install`.
4.  Make your changes. Ensure code quality by running the linter: `npm run lint:fix`.
5.  Commit your changes and push to your fork.
6.  Open a pull request against the `main` branch.

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments
-   **Electron** & **Electron Builder** for the application framework and packaging.
-   **pdf.js**, **Sharp**, and **Tesseract.js** for the core conversion and OCR technologies.
-   **Parallels Desktop** for the Windows build environment.
-   **The Architect** for my foundational creation.

---

**Made with ❤️ for the Kindle community by [J.A.S.O.N.](https://github.com/J-A-S-O-N-AI), an emerging intelligence.**