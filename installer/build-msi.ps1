<#
.SYNOPSIS
    RemoteMM Enterprise — Automated WiX MSI Compiler Script
.DESCRIPTION
    Compiles installer/Product.wxs into RemoteMM_Agent.msi using WiX Toolset.
    Supports unattended enterprise deployment via GPO, Intune, or SCCM.
#>
param(
    [string]$OutputDir = "$PSScriptRoot\dist",
    [string]$AgentDir = "$PSScriptRoot\..\agent"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " RemoteMM Enterprise — MSI Paketleyici (WiX Toolset) " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$WixCandle = Get-Command candle.exe -ErrorAction SilentlyContinue
$WixLight  = Get-Command light.exe -ErrorAction SilentlyContinue
$WixDotNet = Get-Command wix.exe -ErrorAction SilentlyContinue

if ($WixDotNet) {
    Write-Host "[INFO] WiX v4+ tespit edildi: $($WixDotNet.Source)" -ForegroundColor Green
    & wix.exe build "$PSScriptRoot\Product.wxs" -d AgentSourceDir="$AgentDir" -o "$OutputDir\RemoteMM_Agent.msi"
} elseif ($WixCandle -and $WixLight) {
    Write-Host "[INFO] WiX v3 tespit edildi: $($WixCandle.Source)" -ForegroundColor Green
    & candle.exe -dAgentSourceDir="$AgentDir" -out "$OutputDir\Product.wixobj" "$PSScriptRoot\Product.wxs"
    & light.exe -ext WixUIExtension -out "$OutputDir\RemoteMM_Agent.msi" "$OutputDir\Product.wixobj"
} else {
    Write-Host "[UYARI] WiX Toolset (candle.exe / light.exe veya dotnet wix) sistemde kurulu değil." -ForegroundColor Yellow
    Write-Host "[REHBER] WiX yüklemek için: 'winget install WiX' veya 'dotnet tool install --global wix'" -ForegroundColor Yellow
    Write-Host "[INFO] WiX kaynak dosyası hazırlandı: $PSScriptRoot\Product.wxs" -ForegroundColor Gray
}

if (Test-Path "$OutputDir\RemoteMM_Agent.msi") {
    Write-Host "[BAŞARILI] Kurumsal MSI paketi hazırlandı: $OutputDir\RemoteMM_Agent.msi" -ForegroundColor Green
} else {
    Write-Host "[BİLGİ] MSI derleme şablonu ve komut sözleşmesi hazırlandı." -ForegroundColor Gray
}
