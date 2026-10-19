<#
.SYNOPSIS
    RemoteMM Enterprise Agent - Active Directory GPO & Microsoft Intune Deployment Script
.DESCRIPTION
    Bu betik, Active Directory Group Policy (Startup Script) veya Microsoft Intune / SCCM
    aracılığıyla kurumsal Windows istemcilerine ve sunucularına RemoteMM Agent'ını
    sessizce dağıtır, güvenlik duvarı kurallarını ayarlar ve SYSTEM yetkisiyle başlatır.
.PARAMETER GatewayServer
    Merkezi RemoteMM Gateway sunucu adresi (örn. http://rmm.sirket.local:3001)
.PARAMETER TargetDir
    Yerel kurulum klasörü (varsayılan: C:\RemoteMM)
.PARAMETER ExpectedSha256
    İndirilen çalıştırılabilir dosyanın doğrulanacak SHA-256 özeti (isteğe bağlı)
.PARAMETER ForceReinstall
    Mevcut sürüm olsa dahi zorla yeniden kurulsun mu ($false / $true)
#>

[CmdletBinding()]
param(
    [string]$GatewayServer = "http://localhost:3001",
    [string]$TargetDir = "C:\RemoteMM",
    [string]$ExpectedSha256 = "",
    [switch]$ForceReinstall
)

$ErrorActionPreference = "Stop"
$LogFile = Join-Path $TargetDir "deployment.log"

function Write-DeployLog {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] [$Level] $Message"
    Write-Host $line
    try {
        if (-not (Test-Path $TargetDir)) { New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    } catch {}
}

try {
    Write-DeployLog "=== RemoteMM Enterprise Ajan Dağıtımı Başlatıldı ==="
    
    # 1. Administrator Hakları Doğrulaması
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-DeployLog "HATA: Dağıtım betiği Yönetici veya SYSTEM yetkisi gerektirir." "ERROR"
        exit 1
    }

    # 2. Dizin Hazırlığı
    if (-not (Test-Path $TargetDir)) {
        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
        Write-DeployLog "Kurulum dizini oluşturuldu: $TargetDir"
    }

    $AgentExe = Join-Path $TargetDir "RemoteMM_Agent.exe"
    $TempExe = Join-Path $env:TEMP "RemoteMM_Agent_Setup.exe"

    # 3. İndirme (TLS 1.2 Zorunlu)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $DownloadUrl = "$GatewayServer/RemoteMM_Agent.exe"
    Write-DeployLog "Ajan ikili dosyası indiriliyor: $DownloadUrl"

    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempExe -UseBasicParsing -TimeoutSec 60
    } catch {
        Write-DeployLog "İndirme başarısız oldu: $($_.Exception.Message). Yerel dosya kontrol ediliyor..." "WARN"
        if (-not (Test-Path $AgentExe)) {
            Write-DeployLog "Kritik Hata: Uzak sunucudan indirilemedi ve yerel ajan mevcut değil." "ERROR"
            exit 2
        }
    }

    # 4. SHA-256 Bütünlük Denetimi (Eğer parametre olarak verildiyse)
    if (Test-Path $TempExe) {
        $actualHash = (Get-FileHash -Path $TempExe -Algorithm SHA256).Hash.ToLower()
        if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256)) {
            if ($actualHash -ne $ExpectedSha256.ToLower()) {
                Write-DeployLog "GÜVENLİK HATASI: İndirilen dosyanın SHA-256 özeti beklenenle eşleşmedi! Beklenen: $ExpectedSha256, Hesaplanan: $actualHash" "ERROR"
                Remove-Item -Path $TempExe -Force -ErrorAction SilentlyContinue
                exit 3
            }
            Write-DeployLog "SHA-256 Bütünlük doğrulaması başarılı ($actualHash)."
        }

        # Eski ajanı durdur ve yenisini kopyala
        Stop-Process -Name "RemoteMM_Agent" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        Copy-Item -Path $TempExe -Destination $AgentExe -Force
        Remove-Item -Path $TempExe -Force -ErrorAction SilentlyContinue
        Write-DeployLog "Ajan ikili dosyası güncellendi: $AgentExe"
    }

    # 5. Windows Güvenlik Duvarı Yapılandırması (TCP 6129 & WoL UDP 7,9)
    netsh advfirewall firewall delete rule name="RemoteMMAgent" 2>&1 | Out-Null
    netsh advfirewall firewall add rule name="RemoteMMAgent" dir=in action=allow protocol=TCP localport=6129 2>&1 | Out-Null
    netsh advfirewall firewall delete rule name="RemoteMM_WoL_In" 2>&1 | Out-Null
    netsh advfirewall firewall add rule name="RemoteMM_WoL_In" dir=in action=allow protocol=UDP localport=7,9 2>&1 | Out-Null
    Write-DeployLog "Güvenlik Duvarı kuralları doğrulandı (Inbound TCP 6129, UDP 7,9)."

    # 6. Windows Zamanlanmış Görev (Task Scheduler) ile SYSTEM Otomatik Başlatma
    schtasks /delete /tn "RemoteMMAgent" /f 2>&1 | Out-Null
    $createCmd = "schtasks /create /tn RemoteMMAgent /tr `"$AgentExe`" /ru `"SYSTEM`" /sc ONSTART /rl HIGHEST /f"
    Invoke-Expression $createCmd 2>&1 | Out-Null

    # 7. Ajanı Hemen Başlat
    schtasks /run /tn "RemoteMMAgent" 2>&1 | Out-Null
    Start-Sleep -Seconds 2

    # 8. Sağlık Kontrolü (Port 6129 dinleniyor mu?)
    $listener = Get-NetTCPConnection -LocalPort 6129 -ErrorAction SilentlyContinue
    if ($listener) {
        Write-DeployLog "BAŞARILI: RemoteMM Agent çalışıyor ve 6129 numaralı portu dinliyor." "SUCCESS"
        exit 0
    } else {
        Write-DeployLog "UYARI: Ajan başlatıldı ancak 6129 portu henüz dinleme durumuna geçmedi." "WARN"
        exit 0
    }
} catch {
    Write-DeployLog "Beklenmeyen Dağıtım Hatası: $($_.Exception.Message)" "ERROR"
    exit 99
}
