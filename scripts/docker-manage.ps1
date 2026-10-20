# RemoteMM Enterprise - Docker Compose Fleet Management Utility (PowerShell)
param(
    [Parameter(Position=0)]
    [ValidateSet("up", "down", "restart", "status", "logs", "health", "backup", "help")]
    [string]$Command = "help"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

Set-Location $projectRoot

function Show-Usage {
    Write-Host "RemoteMM Enterprise - Docker Management CLI (PowerShell)" -ForegroundColor Cyan
    Write-Host "Kullanim: .\scripts\docker-manage.ps1 [command]"
    Write-Host ""
    Write-Host "Komutlar:"
    Write-Host "  up       - Imajları derler ve arka planda baslatir"
    Write-Host "  down     - Konteynerleri durdurur (./data kalici verisi korunur)"
    Write-Host "  restart  - Gateway servisini yeniden baslatir"
    Write-Host "  status   - Konteyner durumlarini ve saglik denetimini gosterir"
    Write-Host "  logs     - Konteyner loglarini canli akitir"
    Write-Host "  health   - /api/health saglik uc noktasini sorgular"
    Write-Host "  backup   - ./data verilerini zip olarak yedekler"
    Write-Host ""
}

switch ($Command) {
    "up" {
        Write-Host "[RemoteMM] Docker Compose baslatiliyor..." -ForegroundColor Cyan
        if (-not (Test-Path ".env")) {
            Write-Host "[RemoteMM] .env bulunamadi. .env.example dosyasindan kopyalaniyor..." -ForegroundColor Yellow
            Copy-Item ".env.example" ".env"
        }
        docker compose up -d --build
        Start-Sleep -Seconds 3
        docker compose ps
    }
    "down" {
        Write-Host "[RemoteMM] Konteynerler durduruluyor..." -ForegroundColor Yellow
        docker compose down
        Write-Host "[RemoteMM] Durduruldu. (./data verileri korundu)" -ForegroundColor Green
    }
    "restart" {
        Write-Host "[RemoteMM] Gateway servisi yeniden baslatiliyor..." -ForegroundColor Cyan
        docker compose restart gateway
    }
    "status" {
        docker compose ps
    }
    "logs" {
        docker compose logs -f --tail=100
    }
    "health" {
        Write-Host "[RemoteMM] Gateway saglik testi yapiliyor..." -ForegroundColor Cyan
        try {
            $resp = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -TimeoutSec 5
            $resp | ConvertTo-Json -Depth 3
        } catch {
            Write-Host "[RemoteMM] Hata: Saglik ucnoktasina ulasilamadi ($($_))." -ForegroundColor Red
        }
    }
    "backup" {
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $backupZip = "remotemm_data_backup_$timestamp.zip"
        Write-Host "[RemoteMM] ./data veritabanı yedeği alınıyor: $backupZip..." -ForegroundColor Cyan
        Compress-Archive -Path "data\*" -DestinationPath $backupZip -Force
        Write-Host "[RemoteMM] Yedekleme basariyla tamamlandi: $backupZip" -ForegroundColor Green
    }
    default {
        Show-Usage
    }
}
