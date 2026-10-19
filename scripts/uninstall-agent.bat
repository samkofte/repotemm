@echo off
REM ==============================================================================
REM RemoteMM Enterprise Agent - Silent Unattended Uninstaller
REM ==============================================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [HATA] Bu kaldirma islemini calistirmak icin Yonetici haklari gereklidir.
    exit /b 1
)

echo [RemoteMM] Enterprise Agent Kaldirma Islemi Baslatiliyor...

REM 1. Calisan Sureci Sonlandir
taskkill /F /IM RemoteMM_Agent.exe >nul 2>&1

REM 2. Zamanlanmis Gorevi Sil
schtasks /delete /tn "RemoteMMAgent" /f >nul 2>&1

REM 3. Guvenlik Duvari Kurallarini Sil
netsh advfirewall firewall delete rule name="RemoteMMAgent" >nul 2>&1
netsh advfirewall firewall delete rule name="RemoteMM_WoL_In" >nul 2>&1

REM 4. Dosyalari Temizle
if exist "C:\RemoteMM\RemoteMM_Agent.exe" (
    del /F /Q "C:\RemoteMM\RemoteMM_Agent.exe" >nul 2>&1
)

echo [RemoteMM] Ajan, zamanlanmis gorev ve guvenlik duvari kurallari basariyla kaldirildi.
exit /b 0
