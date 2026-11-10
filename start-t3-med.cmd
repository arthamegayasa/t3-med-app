@echo off
rem Starts the T3 Med server built from this checkout and opens it in the browser.
rem Close this window to stop T3 Med. Extra arguments are passed through, for
rem example: start-t3-med.cmd --no-browser
setlocal
set "T3MED_WORKSPACE=D:\T3 Projects\T3 Med"
cd /d "%~dp0"
if not exist "apps\server\dist\bin.mjs" (
  echo T3 Med is not built yet. From this folder run: vp run --filter t3 build
  pause
  exit /b 1
)
"%LOCALAPPDATA%\vite-plus\bin\node.exe" apps\server\dist\bin.mjs --port 3899 --auto-bootstrap-project-from-cwd %* "%T3MED_WORKSPACE%"
