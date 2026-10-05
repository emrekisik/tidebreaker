@echo off
rem Starts the game (server + client) without needing pnpm on PATH.
rem Double-click this file, or run .\dev.cmd from a terminal in this folder.
set "PATH=%PATH%;%APPDATA%\npm"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found. Install it with:  npm i -g pnpm
  pause
  exit /b 1
)
pnpm dev
