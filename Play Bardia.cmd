@echo off
rem Builds Bardia and opens it in your browser.
rem Leave this window open while you play. Close it (or press Ctrl+C) to stop the game.
title Bardia
cd /d "%~dp0game"

echo Building Bardia...
call npx vite build
if errorlevel 1 (
  echo.
  echo The build failed. Copy the messages above to Claude.
  pause
  exit /b 1
)

echo.
echo Starting Bardia at http://localhost:4180  (your browser will open by itself)
echo Leave this window open while you play.
echo.
call npx vite preview --port 4180 --strictPort --open
if errorlevel 1 (
  echo.
  echo Could not start. If Bardia is already running in another window, use that one:
  echo   http://localhost:4180
  pause
)
