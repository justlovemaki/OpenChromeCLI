@echo off
set HOST_NAME=com.bridge.relay.host
set REG_PATH=HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%
set JSON_PATH=%~dp0win\com.bridge.relay.host.json


if not exist "%JSON_PATH%" (
    echo Error: %JSON_PATH% not found!
    pause
    exit /b
)

REG ADD "%REG_PATH%" /ve /t REG_SZ /d "%JSON_PATH%" /f

echo.
echo Agent Browser Bridge Host "%HOST_NAME%" registered successfully.
echo.
pause
