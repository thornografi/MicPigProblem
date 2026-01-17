@echo off
cd /d "%~dp0"
start "" /AboveNormal wt -d "%cd%" pwsh -NoExit -Command "claude"
