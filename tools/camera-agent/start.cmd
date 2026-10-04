@echo off
rem  The camera helper — keeps running in the background; the till shows the shop's cameras.
rem  Put a shortcut to this in shell:startup so it comes up with Windows, the same way the print
rem  helper does. Like that one it picks itself back up if it ever stops.
cd /d "%~dp0..\.."
title Regal camera helper
if exist "C:\Program Files\nodejs\node.exe" (set NODE="C:\Program Files\nodejs\node.exe") else (set NODE=node)
:loop
%NODE% tools\camera-agent\agent.mjs
echo helper stopped, restarting in 5s...
timeout /t 5 >nul
goto loop
