<#
.SYNOPSIS
    RemoteMM Enterprise Agent - Health & Integrity Verification Script
#>

[CmdletBinding()]
param()

$TargetDir = "C:\RemoteMM"
$AgentExe = Join-Path $TargetDir "RemoteMM_Agent.exe"
$Port = 6129

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "   RemoteMM Enterprise Agent - Saglik Denetimi   " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

$allOk = $true

# 1. Dosya Varligi
if (Test-Path $AgentExe) {
    $ver = (Get-Item $AgentExe).VersionInfo.ProductVersion
    $hash = (Get-FileHash -Path $AgentExe -Algorithm SHA256).Hash
    Write-Host "[OK] Ajan dosyasi mevcut: $AgentExe" -ForegroundColor Green
    Write-Host "     SHA-256: $hash" -ForegroundColor Gray
} else {
    Write-Host "[HATA] Ajan dosyasi bulunamadi: $AgentExe" -ForegroundColor Red
    $allOk = $false
}

# 2. Calisan Surec
$procs = Get-Process -Name "RemoteMM_Agent" -ErrorAction SilentlyContinue
if ($procs) {
    Write-Host "[OK] Ajan sureci aktif (PID: $($procs.Id -join ', '))" -ForegroundColor Green
} else {
    Write-Host "[HATA] RemoteMM_Agent sureci calismiyor!" -ForegroundColor Red
    $allOk = $false
}

# 3. Port 6129 Dinleme
$portOpen = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if ($portOpen) {
    Write-Host "[OK] Port $Port dinleniyor (Durum: $($portOpen.State -join ', '))" -ForegroundColor Green
} else {
    Write-Host "[HATA] Port $Port dinlenmiyor!" -ForegroundColor Red
    $allOk = $false
}

# 4. Zamanlanmis Gorev
$task = Get-ScheduledTask -TaskName "RemoteMMAgent" -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "[OK] Zamanlanmis Gorev mevcut (Durum: $($task.State))" -ForegroundColor Green
} else {
    Write-Host "[UYARI] RemoteMMAgent zamanlanmis gorevi bulunamadi!" -ForegroundColor Yellow
}

# 5. Guvenlik Duvari
$fwRule = Get-NetFirewallRule -DisplayName "RemoteMMAgent" -ErrorAction SilentlyContinue
if ($fwRule) {
    Write-Host "[OK] Guvenlik Duvari kurali mevcut (Etkin: $($fwRule.Enabled))" -ForegroundColor Green
} else {
    Write-Host "[UYARI] RemoteMMAgent guvenlik duvari kurali bulunamadi!" -ForegroundColor Yellow
}

Write-Host "-------------------------------------------------" -ForegroundColor Cyan
if ($allOk) {
    Write-Host "SONUC: RemoteMM Agent tamamen saglikli ve baglantiya hazir!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "SONUC: Bazi kontroller basarisiz oldu. Lutfen deploy-gpo.ps1 veya install-agent.bat calistirin." -ForegroundColor Red
    exit 1
}
