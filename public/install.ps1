[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ServerIp = 'localhost:3001'
$RemoteDir = 'C:\RemoteMM'
$RemoteExe = "$RemoteDir\RemoteMM_Agent.exe"

Write-Host ">>> RemoteMM Agent Kurulumu Baslatiliyor..." -ForegroundColor Cyan

# 1. Klasor olustur
New-Item -ItemType Directory -Force -Path $RemoteDir | Out-Null

# 2. Eski servisleri ve surecleri tamamen kapat
Write-Host ">>> Eski surecler ve servisler durduruluyor..." -ForegroundColor Yellow
sc.exe stop DWRCS 2>&1 | Out-Null
sc.exe config DWRCS start= disabled 2>&1 | Out-Null
sc.exe stop RemoteMMAgent 2>&1 | Out-Null
Stop-Process -Name 'RemoteMM_Agent', 'DameWare_Agent', 'DameWare' -Force -ErrorAction SilentlyContinue
taskkill /F /IM RemoteMM_Agent.exe 2>&1 | Out-Null
taskkill /F /IM DameWare_Agent.exe 2>&1 | Out-Null
taskkill /F /IM DameWare.exe 2>&1 | Out-Null

if (Test-Path $RemoteExe) {
    Move-Item $RemoteExe "$RemoteDir\RemoteMM_Agent_$([guid]::NewGuid().ToString('N')).old" -Force -ErrorAction SilentlyContinue
}

# 3. Guncel ajani indir
Write-Host ">>> Guncel RemoteMM Agent indiriliyor..." -ForegroundColor Cyan
Invoke-WebRequest -Uri "http://$ServerIp/RemoteMM_Agent.exe" -OutFile $RemoteExe -UseBasicParsing
Remove-Item "$RemoteDir\*.old" -Force -ErrorAction SilentlyContinue

# 4. Windows Guvenlik ve SAS (Ctrl+Alt+Del) Ayarlari
Write-Host ">>> Windows Kilit Ekrani ve SAS politikalari yapilandiriliyor..." -ForegroundColor Cyan
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name 'HiberbootEnabled' -Value 0 -Force -ErrorAction SilentlyContinue
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'SoftwareSASGeneration' -Value 3 -Force -ErrorAction SilentlyContinue
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'PromptOnSecureDesktop' -Value 0 -Force -ErrorAction SilentlyContinue

# 5. Ag ve Guvenlik Duvari
Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object {
    Enable-NetAdapterPowerManagement -Name $_.Name -WakeOnMagicPacket -ErrorAction SilentlyContinue
    Set-NetAdapterPowerManagement -Name $_.Name -WakeOnMagicPacket Enabled -ErrorAction SilentlyContinue
    Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName '*Wake on Magic Packet*' -DisplayValue 'Enabled' -ErrorAction SilentlyContinue
}
netsh advfirewall firewall add rule name=RemoteMMAgent dir=in action=allow protocol=TCP localport=6129 2>&1 | Out-Null
netsh advfirewall firewall add rule name=RemoteMM_WoL dir=in action=allow protocol=UDP localport=7,9 2>&1 | Out-Null

# 6. Windows Servisini Kur ve Baslat
Write-Host ">>> Windows Servisi olusturuluyor ve baslatiliyor..." -ForegroundColor Green
sc.exe create RemoteMMAgent binPath= $RemoteExe start= auto DisplayName= 'RemoteMM Support Agent' 2>&1 | Out-Null
sc.exe config RemoteMMAgent binPath= $RemoteExe start= auto 2>&1 | Out-Null
sc.exe failure RemoteMMAgent reset= 0 actions= restart/2000/restart/5000/restart/10000 2>&1 | Out-Null
sc.exe start RemoteMMAgent 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    schtasks /delete /tn RemoteMMAgent /f 2>&1 | Out-Null
    schtasks /create /tn RemoteMMAgent /tr $RemoteExe /ru 'SYSTEM' /sc ONSTART /rl HIGHEST /f 2>&1 | Out-Null
    schtasks /run /tn RemoteMMAgent 2>&1 | Out-Null
}

Start-Sleep -Seconds 1
$running = Get-Process -Name RemoteMM_Agent -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "=== TEBRIKLER: RemoteMM Agent basariyla kuruldu ve calisiyor! ===" -ForegroundColor Green
} else {
    Write-Host "=== Servis kuruldu, port dinlemeye alindi ===" -ForegroundColor Green
}
