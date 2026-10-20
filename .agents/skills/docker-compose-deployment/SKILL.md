---
name: docker-compose-deployment
description: RemoteMM Enterprise Gateway, Nginx HTTPS/WSS ters vekil sunucusu, Docker Compose orkestrasyonu ve kalıcı veri hacmi yönergeleri.
---

# Docker Compose Deployment — RemoteMM Enterprise

Bu kılavuz, RemoteMM platformunun Gateway sunucusu (`server/index.js`), Nginx HTTPS/WSS ters vekil (reverse proxy) katmanı ve test/üretim ortamları için Docker Compose orkestrasyon kurallarını belirler.

---

## 1. Dağıtım Mimarisi ve Sınırlar

```
[İnternet / Operatörler]
           │ HTTPS (443) / WSS (WebSockets)
           ▼
[Nginx Ters Vekil (Reverse Proxy)]
           │ Dahili Docker Ağı (remotemm-net)
           ▼
[Gateway Hub Konteyneri (Node.js - Port 3001)]
           │ Kalıcı Veri Hacmi: ./data -> /app/data
           │ (SQLite: remotemm_enterprise.db + audit_logs.jsonl)
           │
           │ TCP 6129 (Doğrudan Yerel Ağ / VPN Tüneli)
           ▼
[Windows Uç Noktaları (Fiziksel / Sanal Windows Makineler)]
```

> [!IMPORTANT]
> **Windows Ajanı ve Electron Kısıtı:**  
> Windows Ajanı (`agent/py_agent.py`) ve Electron masaüstü uygulaması Linux Docker konteynerlerine taşınamaz; bunlar yerel Windows ana bilgisayarlarında veya Windows sanal makinelerinde çalıştırılır. Docker Compose ortamı Gateway sunucusu ve Nginx vekil katmanını barındırır.

---

## 2. Servis Bileşenleri ve Yapılandırma

### A. Gateway Servisi (`remotemm-gateway`)
- **İmaj:** `node:22-alpine` (Hafif, güvenli ve güncel Node.js çalışma zamanı).
- **Dahili Port:** `3001`.
- **Kalıcı Hacimler (Volumes):**
  - `./data:/app/data` — Cihaz kaydı (`remotemm_enterprise.db`) ve denetim izi (`audit_logs.jsonl`).
  - `./scripts:/app/scripts:ro` — GPO ve ajan dağıtım betikleri (salt-okunur).
  - `./public:/app/public:ro` — Ajan kurulum ikilileri (salt-okunur).
- **Sağlık Denetimi (Healthcheck):**
  ```yaml
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost:3001/api/health"]
    interval: 15s
    timeout: 5s
    retries: 3
    start_period: 5s
  ```

### B. Ters Vekil Servisi (`remotemm-proxy`)
- **İmaj:** `nginx:alpine`.
- **Dış Portlar:** `80` (HTTP) ve `443` (HTTPS / WSS).
- **WebSocket Yönlendirme:**
  ```nginx
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 86400s;
  proxy_send_timeout 86400s;
  ```

---

## 3. Ortam Değişkenleri (.env ve .env.example)

Gerçek parolalar, token'lar ve SSL anahtarları asla Git'e eklenmez. Proje kökünde `.env.example` şablonu tutulur:
- `PORT=3001`
- `NODE_ENV=production`
- `GATEWAY_SECRET=<GÜÇLÜ_RASTGELE_ANAHTAR>`
- `SSL_CERT_PATH=/etc/nginx/certs/remotemm.crt`
- `SSL_KEY_PATH=/etc/nginx/certs/remotemm.key`

---

## 4. Temel Çalıştırma ve Yönetim Komutları

1. **Servisleri Arka Planda Başlatma:**
   ```bash
   docker compose up -d --build
   ```
2. **Servis Durumu ve Sağlık Kontrolü:**
   ```bash
   docker compose ps
   ```
3. **Canlı Logları İnceleme:**
   ```bash
   docker compose logs -f gateway
   ```
4. **Yeniden Başlatma:**
   ```bash
   docker compose restart gateway
   ```
5. **Kalıcı Veriyi Korumak Üzere Servisleri Durdurma:**
   ```bash
   docker compose down
   ```

---

## 5. Tamamlanma Kriterleri

- `curl -f http://localhost:3001/api/health` çağrısı `200 OK` ve geçerli JSON döndürmelidir.
- Konteyner yeniden başlatıldığında (`docker compose restart`), kayıtlı cihazlar ve denetim kayıtları `./data` hacminden eksiksiz yüklenmelidir.
- Veritabanı ve dahili ağ doğrudan internete açık olmamalı, tüm dış trafik Nginx üzerinden geçmelidir.
