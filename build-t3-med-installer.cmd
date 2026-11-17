@echo off
rem Builds the T3 Med desktop installer for Windows into the release folder, with upstream's
rem packaging script. Unsigned. See docs\t3-med\FORK.md, "The desktop app".
rem Needs: vp (Vite+), Python 3, Rust (rustup, the x86_64-pc-windows-msvc target) and the
rem Visual Studio C++ build tools with a Windows SDK. Extra arguments are passed through,
rem for example: build-t3-med-installer.cmd --keep-stage
setlocal
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\vite-plus\bin;%USERPROFILE%\.cargo\bin;%PATH%"
set "CI=true"

rem An update feed is only ever written from these; T3 Med has none (FORK.md, Updates).
set "GITHUB_REPOSITORY="
set "T3CODE_DESKTOP_UPDATE_REPOSITORY="

rem Upstream's own check for building this helper also demands the Spectre-mitigated MSVC
rem libraries, which the helper does not use. Build it here and let upstream reuse it, as
rem upstream's release workflow does.
cargo build --locked --release --manifest-path native\resource-monitor\Cargo.toml --target x86_64-pc-windows-msvc
if errorlevel 1 (
  echo The resource monitor did not build. Is Rust installed? See docs\t3-med\FORK.md.
  exit /b 1
)
set "T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=true"

node scripts\build-desktop-artifact.ts --platform win --target nsis --arch x64 %*
if errorlevel 1 exit /b 1
echo.
echo The installer is in "%~dp0release".
