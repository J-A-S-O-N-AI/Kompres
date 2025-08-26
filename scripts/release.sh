#!/bin/bash

# Kompres Release Script
# Builds for macOS, Windows (via Parallels), and Linux
# Creates git tag and GitHub release with artifacts
#
# Usage:
#   ./scripts/release.sh local    # Build locally only
#   ./scripts/release.sh mac      # Build macOS only
#   ./scripts/release.sh all      # Build all + GitHub release
#   ./scripts/release.sh github   # GitHub release from existing builds
#
# Prerequisites:
#   - Node.js 16+
#   - Parallels Desktop (for Windows builds)
#   - GitHub CLI (gh) + authenticated (e.g., GH_TOKEN or gh auth login)
#   - Xcode Command Line Tools (macOS)

# NOTE: set -e is disabled in main to allow for parallel execution and custom error handling.

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="Kompres"
GITHUB_REPO="J-A-S-O-N-AI/Kompres"
WINDOWS_VM_NAME="Windows 11"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"

# Helper: Constructs the UNC path to a file on the guest VM's shared filesystem.
# This aligns with the "All Disks" sharing mode recommended in README.md.
posix_to_windows_path() {
    local posix_path="$1"
    
    if [[ "$posix_path" != /* ]]; then
        posix_path="$PROJECT_ROOT/$posix_path"
    fi

    # Parallels 'All Disks' sharing maps the macOS root to a UNC path.
    # We convert /path/to/file into \\Mac\AllFiles\path\to\file
    local win_path_part="${posix_path//\//\\}"
    # The UNC path is \\Mac\AllFiles + the posix path with backslashes
    echo "\\\\Mac\\AllFiles$win_path_part"
}

# Function to print colored output (redirected to stderr to avoid contaminating stdout)
print_status() {
    printf "${BLUE}[INFO]${NC} %s\n" "$1" >&2
}

print_success() {
    printf "${GREEN}[SUCCESS]${NC} %s\n" "$1" >&2
}

print_warning() {
    printf "${YELLOW}[WARNING]${NC} %s\n" "$1" >&2
}

print_error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1" >&2
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Other helper functions
check_github_auth() {
    if ! command_exists "gh"; then
        print_error "GitHub CLI (gh) not found. Please install it to create releases."
        return 1
    fi
    if [[ -n "${GH_TOKEN:-}" || -n "${GITHUB_TOKEN:-}" ]]; then return 0; fi
    if gh auth status >/dev/null 2>&1; then return 0; fi
    print_error "GitHub authentication failed. Please run 'gh auth login' or set GH_TOKEN."
    return 1
}
is_macos() { [[ "$OSTYPE" == "darwin"* ]]; }
parallels_available() { command_exists "prlctl"; }
windows_vm_running() { prlctl list --info "$WINDOWS_VM_NAME" 2>/dev/null | grep -q "running"; }

start_windows_vm() {
    print_status "Starting Windows VM: $WINDOWS_VM_NAME"
    prlctl start "$WINDOWS_VM_NAME"
    print_status "Waiting for Windows VM to be ready..."
    for i in {1..60}; do
        if windows_vm_running; then print_success "Windows VM is ready!"; sleep 10; return 0; fi
        sleep 5
    done
    print_error "Windows VM failed to start within 5 minutes"; return 1
}

run_in_windows() {
    print_status "[HOST] Running in Windows VM: $*"
    # Execute and return the exit code of prlexec
    prlexec "$@"
}

get_version() { node -p "require('./package.json').version"; }
tag_exists() { git tag -l | grep -q "^$1$"; }

create_git_tag() {
    local version="$1"; local tag="v$version"
    if tag_exists "$tag"; then
        print_warning "Git tag $tag already exists. Overwriting..."
        git push --delete origin "$tag" >/dev/null 2>&1 || print_warning "Could not delete remote tag $tag (it may not exist remotely)"
        git tag -d "$tag"
    fi
    print_status "Creating git tag: $tag"
    git tag -a "$tag" -m "Release $tag"
    git push origin "$tag"
    print_success "Git tag $tag created and pushed"
}

build_macos() {
    print_status "[MACOS] Starting macOS build..."
    cd "$PROJECT_ROOT"
    rm -rf "$DIST_DIR/mac"*
    if npm run build:local:mac -- -p never; then
        print_success "[MACOS] macOS build completed."
        return 0
    else
        print_error "[MACOS] macOS build failed."
        return 1
    fi
}

build_windows_sync() {
    print_status "[WINDOWS] Synchronous build process initiated."

    if ! is_macos || ! parallels_available; then
        print_error "[WINDOWS] Parallels build environment not available."
        return 1
    fi
    if ! windows_vm_running; then
        if ! start_windows_vm; then return 1; fi
    fi
    
    local win_script_path
    win_script_path=$(posix_to_windows_path "$PROJECT_ROOT/scripts/build-win.ps1")
    if [ $? -ne 0 ]; then
        return 1
    fi
    print_status "Windows build will run using script: $win_script_path"

    # Execute and wait. The exit code of run_in_windows will determine the return status.
    if run_in_windows pwsh -ExecutionPolicy Bypass -File "$win_script_path"; then
        print_success "[WINDOWS] Windows build completed successfully."
        return 0
    else
        print_error "[WINDOWS] Windows build failed."
        return 1
    fi
}

build_linux() {
    print_status "[LINUX] Starting Linux build..."
    cd "$PROJECT_ROOT"
    rm -rf "$DIST_DIR/linux"*
    if npm run build:local:linux -- -p never; then
        print_success "[LINUX] Linux build completed."
        return 0
    else
        print_error "[LINUX] Linux build failed."
        return 1
    fi
}

create_github_release() {
    local version="$1"; local tag="v$version"
    print_status "Creating GitHub release for tag $tag..."
    if ! check_github_auth; then return 1; fi

    # If a release for this tag already exists, delete it first to emulate --clobber.
    if gh release view "$tag" --repo "$GITHUB_REPO" >/dev/null 2>&1; then
        print_warning "Release for tag $tag already exists. Deleting it to recreate..."
        if ! gh release delete "$tag" --repo "$GITHUB_REPO" --yes; then
            print_error "Failed to delete existing release for $tag."
            return 1
        fi
        print_success "Successfully deleted existing release."
    fi

    if gh release create "$tag" --repo "$GITHUB_REPO" --title "$APP_NAME $version" --generate-notes; then
        print_success "GitHub release for $tag created successfully."
        return 0
    else
        print_error "Failed to create GitHub release."
        return 1
    fi
}

upload_release_assets() {
    local version="$1"; local tag="v$version"
    print_status "Uploading release assets for tag $tag..."
    if ! check_github_auth; then return 1; fi

    local assets=()
    # Iterate over all items in the dist directory and select only files.
    # This prevents attempts to upload intermediate build directories.
    for item in "$DIST_DIR"/*; do
        if [[ -f "$item" ]]; then
            local filename=$(basename "$item")
            # Exclude intermediate build configuration files.
            if [[ "$filename" != "builder-debug.yml" && "$filename" != "builder-effective-config.yaml" ]]; then
                assets+=("$item")
            fi
        fi
    done

    if [[ ${#assets[@]} -eq 0 ]]; then
        print_warning "No distributable artifacts found in $DIST_DIR to upload. Skipping upload."
        return 0
    fi

    print_status "Found assets to upload:"
    for asset in "${assets[@]}"; do
        printf "  - %s\n" "$(basename "$asset")" >&2
    done

    if gh release upload "$tag" "${assets[@]}" --repo "$GITHUB_REPO" --clobber; then
        print_success "All assets uploaded successfully."
        return 0
    else
        print_error "Failed to upload one or more assets."
        return 1
    fi
}

main() {
    local mode="${1#--}"; mode="${mode:-all}"
    print_status "Starting $APP_NAME release process (mode: $mode)..."
    
    if ! command_exists "node" || ! command_exists "npm"; then
        print_error "Node.js and npm are required."
        exit 1
    fi

    local version; version=$(get_version)
    print_status "Building $APP_NAME version $version"
    
    if [[ "$mode" != "github" ]]; then
        print_status "Cleaning dist directory..."
        rm -rf "$DIST_DIR"
        mkdir -p "$DIST_DIR"
    fi

    local do_win=false; local do_mac=false; local do_linux=false; local do_release=false
    case "$mode" in
        "local"|"all") do_win=true; do_mac=true; do_linux=true; if [[ "$mode" == "all" ]]; then do_release=true; fi;;
        "mac") do_mac=true;;
        "github") do_release=true;;
        *) print_error "Invalid mode. Use: local, mac, all, or github"; exit 1;;
    esac
    
    if [[ "$do_release" == true ]]; then create_git_tag "$version" || exit 1; fi

    local mac_ok=true; local linux_ok=true; local win_ok=true; local build_requested=false
    if [[ "$do_win" == true || "$do_mac" == true || "$do_linux" == true ]]; then build_requested=true; fi

    # Install dependencies first if any build is requested
    if [[ "$build_requested" == true ]]; then
        print_status "Ensuring host dependencies are installed..."
        npm install
    fi

    # Run builds
    if [[ "$do_mac" == true ]]; then
        if is_macos; then
            build_macos || mac_ok=false
        else
            print_warning "Skipping macOS build (not on macOS)"; mac_ok=false
        fi
    fi
    
    if [[ "$do_linux" == true ]]; then
        build_linux || linux_ok=false
    fi

    if [[ "$do_win" == true ]]; then
        if is_macos && parallels_available; then
            print_status "Starting Windows build synchronously..."
            build_windows_sync || win_ok=false
        else
            print_warning "Skipping Windows build (Parallels not available or not on macOS)"; win_ok=false
        fi
    fi

    # Summarize build results
    if [[ "$build_requested" == true ]]; then
        print_status "================ BUILD SUMMARY ================"
        if [[ "$do_mac" == true ]]; then [[ "$mac_ok" == true ]] && print_success "macOS build: SUCCEEDED" || print_error "macOS build: FAILED"; fi
        if [[ "$do_linux" == true ]]; then [[ "$linux_ok" == true ]] && print_success "Linux build: SUCCEEDED" || print_error "Linux build: FAILED"; fi
        if [[ "$do_win" == true ]]; then [[ "$win_ok" == true ]] && print_success "Windows build: SUCCEEDED" || print_error "Windows build: FAILED"; fi
        
        local overall_success=true
        if [[ ("$do_mac" == true && "$mac_ok" != true) || ("$do_linux" == true && "$linux_ok" != true) || ("$do_win" == true && "$win_ok" != true) ]]; then
            overall_success=false
        fi
        
        if [[ "$overall_success" != true ]]; then print_error "One or more builds failed. Please check the logs."; exit 1; fi
        print_success "All requested builds completed successfully!"
    fi

    # Handle GitHub Release
    if [[ "$do_release" == true ]]; then
        if create_github_release "$version" && upload_release_assets "$version"; then
            print_success "GitHub release process completed."
        else
            print_error "GitHub release process failed."; exit 1
        fi
    fi
}

main "$@"