@echo off
rem Regal Hardware print helper — keeps running in the background; bills print on the right printer.
cd /d "%~dp0"
title Regal print helper
if exist "C:\Program Files\nodejs\node.exe" (set NODE="C:\Program Files\nodejs\node.exe") else (set NODE=node)
:loop
%NODE% agent.mjs
echo helper stopped, restarting in 5s…
timeout /t 5 >nul
goto loop
