@echo off
rem Rebuilds ..\StartDashboard.exe from StartDashboard.cs using the C# compiler that
rem ships with Windows (.NET Framework 4.x). Nothing needs to be installed.
setlocal
cd /d "%~dp0"
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo The .NET Framework 4 C# compiler was not found on this PC.
  exit /b 1
)
"%CSC%" /nologo /optimize+ /target:exe /platform:anycpu /win32icon:shield.ico /out:..\StartDashboard.exe StartDashboard.cs
if errorlevel 1 exit /b 1
echo Built ..\StartDashboard.exe
