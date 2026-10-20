@echo off
REM ==============================================================================
REM RemoteMM Enterprise Agent - Silent Unattended Installer
REM Supported OS: Windows 10, Windows 11, Windows Server 2016/2019/2022/2025
REM Execution Context: Administrator or SYSTEM (SCCM, Intune, GPO, PDQ Deploy)
REM ==============================================================================

setlocal EnableDelayedExpansion

echo [RemoteMM] Enterprise Agent Silent Installation Started...

REM 1. Administrator Haklari Kontrolu
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [HATA] Bu yukleyiciyi calistirmak icin Yonetici (Elevated Admin) haklari gereklidir.
    exit /b 1
)

set "INSTALL_DIR=C:\RemoteMM"
set "AGENT_EXE=%INSTALL_DIR%\RemoteMM_Agent.exe"
set "PORT=6129"

REM 2. Hedef Kurulum Dizinini Olustur
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%" >nul 2>&1
)

REM 3. Calisan Eski Agent Sureclerini Sonlandir
taskkill /F /IM RemoteMM_Agent.exe >nul 2>&1

REM 4. Ikili Dosyayi Kopyala (Eger ayni dizinde RemoteMM_Agent.exe varsa)
if exist "%~dp0RemoteMM_Agent.exe" (
    copy /Y "%~dp0RemoteMM_Agent.exe" "%AGENT_EXE%" >nul 2>&1
    echo [RemoteMM] Ajan dosyasi yerel dizinden kopyalandi: %AGENT_EXE%
) else if exist "%~dp0agent\dist\RemoteMM_Agent.exe" (
    copy /Y "%~dp0agent\dist\RemoteMM_Agent.exe" "%AGENT_EXE%" >nul 2>&1
    echo [RemoteMM] Ajan dosyasi dist dizininden kopyalandi: %AGENT_EXE%
)

REM 5. Windows Guvenlik Duvari Kurallarini Ekle
netsh advfirewall firewall delete rule name="RemoteMMAgent" >nul 2>&1
netsh advfirewall firewall add rule name="RemoteMMAgent" dir=in action=allow protocol=TCP localport=%PORT% >nul 2>&1

netsh advfirewall firewall delete rule name="RemoteMM_WoL_In" >nul 2>&1
netsh advfirewall firewall add rule name="RemoteMM_WoL_In" dir=in action=allow protocol=UDP localport=7,9 >nul 2>&1
echo [RemoteMM] Windows Guvenlik Duvari kurallari tanimlandi (TCP %PORT%, UDP 7,9).

REM 6. Windows SCM (Service Control Manager) ve Self-Healing Yapilandirmasi
sc.exe stop RemoteMMAgent >nul 2>&1
sc.exe delete RemoteMMAgent >nul 2>&1
sc.exe create RemoteMMAgent binPath= "\"%AGENT_EXE%\" --service" start= auto obj= "NT AUTHORITY\System" DisplayName= "RemoteMM Enterprise Agent" >nul 2>&1

if %errorlevel% equ 0 (
    echo [RemoteMM] SCM Windows Servisi basariyla olusturuldu.
    sc.exe failure RemoteMMAgent reset= 86400 actions= restart/5000/restart/10000/restart/30000 >nul 2>&1
    sc.exe failureflag RemoteMMAgent 1 >nul 2>&1
    sc.exe start RemoteMMAgent >nul 2>&1
    echo [RemoteMM] SCM Self-Healing kurallari uygulandi (5s/10s/30s restart).
) else (
    echo [UYARI] SCM Servisi olusturulamadi, Task Scheduler yedegine geciliyor...
    schtasks /delete /tn "RemoteMMAgent" /f >nul 2>&1
    schtasks /create /tn "RemoteMMAgent" /tr "\"%AGENT_EXE%\"" /ru "SYSTEM" /sc ONSTART /rl HIGHEST /f >nul 2>&1
    if %errorlevel% equ 0 (
        echo [RemoteMM] SYSTEM Gorevi (ONSTART / HIGHEST) olusturuldu.
        schtasks /run /tn "RemoteMMAgent" >nul 2>&1
        echo [RemoteMM] RemoteMM Ajan servisi basariyla baslatildi.
    ) else (
        echo [HATA] Gorev veya servis olusturulamadi, hata kodu: %errorlevel%
        exit /b %errorlevel%
    )
)

echo [RemoteMM] Kurulum basariyla tamamlandi.
exit /b 0
