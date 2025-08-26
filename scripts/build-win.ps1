#
# PowerShell script for Windows build.
# This script uses robust self-elevation and propagates exit codes to ensure
# synchronous execution when called from an external script (e.g., via Parallels).
#

# --- Self-Elevation ---
# This block is the entry point. If not running as admin, it re-launches itself
# with elevated privileges, waits for it to complete, and then exits with the
# same exit code as the elevated process.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Requesting Administrator privileges to run the build script..."
    Write-Host "A UAC prompt will appear. Please accept it to continue."
    
    $scriptPath = $MyInvocation.MyCommand.Path
    $arguments = "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", """$scriptPath""", "-elevated"

    try {
        # Re-launch self as admin, wait for it to finish, and capture the process object.
        $process = Start-Process pwsh -Verb RunAs -ArgumentList $arguments -Wait -PassThru
        # Propagate the exit code from the elevated process back to the caller.
        exit $process.ExitCode
    } catch {
        Write-Error "Failed to elevate script or the elevated script failed. Error: $($_.Exception.Message)"
        exit 1
    }
}


# --- Elevated Execution Block ---
# The script only proceeds past this point if it is running as Administrator.

# Check if the script was launched correctly by its non-elevated counterpart.
if (-not ($args.Contains('-elevated'))) {
    Write-Error "This script must be launched without administrator privileges. It will elevate itself."
    exit 1
}

$ErrorActionPreference = 'Stop'
$exitCode = 1 # Default to failure

# --- Path Configuration ---
$ScriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourcePath = Split-Path -Parent $ScriptDirectory

# Helper function for logging
function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] [GUEST] [$Level] $Message"
}

try {
    Write-Log "Windows build script started inside VM (with Administrator privileges)."

    # --- Configuration ---
    $BuildPath = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath "pdf2epub_build_$(Get-Random)"
    
    Write-Log "Final paths:"
    Write-Log "  Source path (shared): $SourcePath"
    Write-Log "  Build path (local temp): $BuildPath"

    # --- Pre-flight Checks ---
    if (-not (Test-Path -LiteralPath $SourcePath)) {
        throw "Source path not found: $SourcePath. Ensure Parallels 'All Disks' or 'Home' share is enabled."
    }

    # --- Environment Cleanup ---
    Write-Log "Cleaning up temporary build environment..."
    if (Test-Path $BuildPath) {
        Write-Log "Removing existing build directory: $BuildPath"
        Remove-Item -Recurse -Force $BuildPath -ErrorAction SilentlyContinue
    }
    
    New-Item -Path $BuildPath -ItemType Directory -Force

    # --- Copy Source Code ---
    Write-Log "Copying project source from '$SourcePath' to build directory '$BuildPath'..."
    $robocopyArgs = @(
        $SourcePath,
        $BuildPath,
        "/MIR",
        "/XD", "node_modules", "dist", ".git", ".vscode",
        "/XF", "package-lock.json",
        "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"
    )
    & robocopy @robocopyArgs

    if (-not (Test-Path (Join-Path -Path $BuildPath -ChildPath "package.json"))) {
        throw "Failed to copy package.json to build directory. Robocopy may have failed."
    }
    Write-Log "Source copy complete."

    # --- Build Process ---
    Set-Location -LiteralPath $BuildPath
    Write-Log "Changed directory to: $((Get-Location).Path)"

    Write-Log "Installing NPM dependencies in build directory..."
    npm install
    Write-Log "NPM dependencies installed successfully."
    
    Write-Log "Running the Windows build..."
    npm run build:local:win -- -p never
    Write-Log "Windows build completed successfully."

    # --- Publish Artifacts ---
    $BuildDistPath = Join-Path -Path $BuildPath -ChildPath "dist"
    $FinalDistPath = Join-Path -Path $SourcePath -ChildPath "dist"

    if (-not (Test-Path $BuildDistPath)) {
        throw "Build succeeded, but local dist directory was not found at $BuildDistPath"
    }

    Write-Log "Copying final artifacts from '$BuildDistPath' back to shared source '$FinalDistPath'..."
    Copy-Item -Path (Join-Path $BuildDistPath "*") -Destination $FinalDistPath -Recurse -Force
    Write-Log "Artifacts published to shared folder successfully."

    # If we reached this point, the build was a success.
    $exitCode = 0
    Write-Log "Windows build script finished successfully."

} catch {
    Write-Log "An error occurred during the Windows build process:" -Level "ERROR"
    Write-Log $_.Exception.Message -Level "ERROR"
    $exitCode = 1
} finally {
    # --- Final Cleanup ---
    if ($BuildPath -and (Test-Path $BuildPath)) {
        Write-Log "Cleaning up temporary build directory: $BuildPath"
        Remove-Item -Recurse -Force $BuildPath -ErrorAction SilentlyContinue
    }
    
    # --- Exit with the final code ---
    exit $exitCode
}