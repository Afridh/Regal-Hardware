@echo off
rem  The camera helper. Put a shortcut to this in shell:startup so it comes up with Windows,
rem  the same way the print helper does.
cd /d "%~dp0..\.."
node tools\camera-agent\agent.mjs
pause
