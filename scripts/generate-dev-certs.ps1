# RemoteMM Enterprise - Self-Signed SSL Certificate Generator for Local Dev (PowerShell)
param(
    [string]$Domain = "localhost"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$certsDir = Join-Path $projectRoot "nginx\certs"

if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir -Force | Out-Null
}

$certFile = Join-Path $certsDir "fullchain.pem"
$keyFile  = Join-Path $certsDir "privkey.pem"

Write-Host "[RemoteMM] Self-signed SSL sertifikasi uretiliyor (Domain: $Domain)..." -ForegroundColor Cyan

# Check if openssl is installed in path
$hasOpenSsl = Get-Command openssl -ErrorAction SilentlyContinue

if ($hasOpenSsl) {
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 `
        -keyout $keyFile `
        -out $certFile `
        -subj "/C=TR/ST=Istanbul/L=Istanbul/O=RemoteMM Enterprise/CN=$Domain" `
        -addext "subjectAltName=DNS:$Domain,DNS:localhost,IP:127.0.0.1"
    Write-Host "[RemoteMM] OpenSSL ile sertifikalar basariyla olusturuldu." -ForegroundColor Green
} else {
    Write-Host "[RemoteMM] OpenSSL bulunamadi. PowerShell New-SelfSignedCertificate kullaniliyor..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate -DnsName $Domain, "localhost", "127.0.0.1" -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(1)
    
    # Export certificate (PEM)
    $certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $certBase64 = [System.Convert]::ToBase64String($certBytes, [System.Base64FormattingOptions]::InsertLineBreaks)
    $certPem = "-----BEGIN CERTIFICATE-----`r`n" + $certBase64 + "`r`n-----END CERTIFICATE-----"
    [System.IO.File]::WriteAllText($certFile, $certPem)

    # Note on private key
    Write-Host "[RemoteMM] Sertifika $certFile dosyasina yazildi." -ForegroundColor Green
    Write-Host "[RemoteMM] UYARI: Tam HTTPS testi icin OpenSSL ile privkey.pem olusturulmasi onerilir." -ForegroundColor Yellow
}

Write-Host "  Sertifika : $certFile"
Write-Host "  Ozel Anahtar: $keyFile"
