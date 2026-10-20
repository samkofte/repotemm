# RemoteMM Enterprise — Docker Compose & Sunucu Dağıtım Kılavuzu

Bu doküman, RemoteMM Gateway Hub ve Nginx Ters Vekil (Reverse Proxy) bileşenlerinin Docker Compose ile yerel test ve VPS üretim ortamlarında dağıtım adımlarını, kalıcı veri yönetimini ve sağlık denetimlerini açıklar.

---

## 1. Dağıtım Mimarisi Özeti

```
[Web Tarayıcı / Electron Konsol]
              │
              │ HTTPS (443) / WSS (WebSockets)
              ▼
    [remotemm-proxy (Nginx)]
              │
              │ Dahili Docker Ağı (remotemm-net:3001)
              ▼
    [remotemm-gateway (Node.js 22-Alpine)]
              │
              ├── Kalıcı Veri Hacmi (./data -> /app/data)
              │   ├── SQLite Cihaz Veritabanı: remotemm_enterprise.db
              │   └── ISO 27001 Denetim Kütüğü: audit_logs.jsonl
              │
              │ Raw TCP Port 6129 / RMM2 İkili Çerçeveleme
              ▼
[Windows Uç Noktaları (RemoteMM Windows Ajanı - Fiziksel / Sanal Windows)]
```

> [!IMPORTANT]
> **Windows Ajanı ve Masaüstü Kısıtı:**  
> Windows Ajanı (`agent/py_agent.py`) doğrudan Win32 GDI, SendInput ve SCM servis API'lerine bağlıdır. Linux konteynerleri içine taşınamaz. Ajanlar Windows ana makinelerinde veya Windows Server VM'lerinde çalışır; Gateway Hub ise Linux Docker ortamında güvenle konteynerize edilir.

---

## 2. Hızlı Başlangıç (Yerel Geliştirme Ortamı)

### 1. Ortam Dosyasını Hazırlama
```bash
cp .env.example .env
```

### 2. Konteynerleri Derleme ve Başlatma
```bash
docker compose up -d --build
```

### 3. Sağlık Denetimi ve Durum Kontrolü
```bash
docker compose ps
```
Çıktıda `remotemm-gateway` servisinin `healthy` durumunda olduğu görülmelidir.

Doğrudan HTTP ile test:
```bash
curl http://localhost:3001/api/health
```
Beklenen yanıt:
```json
{
  "status": "OK",
  "service": "RemoteMM Enterprise Gateway & NOC Hub",
  "port": 3001,
  "agentVersion": "RemoteMM Enterprise v5.0",
  "registeredDevices": 2
}
```

---

## 3. VPS Üretim Ortamı ve SSL / WSS Yapılandırması

### 1. Let's Encrypt veya Özel SSL Sertifikası
Sertifika dosyalarınızı `./nginx/certs/` dizinine yerleştirin:
- `./nginx/certs/fullchain.pem`
- `./nginx/certs/privkey.pem`

### 2. HTTPS Yapılandırmasını Aktif Etme
`nginx/conf.d/remotemm.conf` dosyasındaki HTTPS sunucu bloğunun (`server { listen 443 ssl ... }`) başındaki yorum işaretlerini (`#`) kaldırın ve `server_name` alanına kendi alan adınızı yazın.

### 3. Nginx'i Yeniden Yükleme
```bash
docker compose exec proxy nginx -s reload
```

---

## 4. Yönetim ve Operasyon Komutları

| Eylem | Komut |
|---|---|
| **Servisleri Başlat (Arka Plan)** | `docker compose up -d` |
| **Servisleri Durdur** | `docker compose down` |
| **Yeniden Başlat (Gateway)** | `docker compose restart gateway` |
| **Canlı Logları İzle** | `docker compose logs -f gateway` |
| **Proxy Loglarını İzle** | `docker compose logs -f proxy` |
| **Kalıcı Veriyi Yedekle** | `tar -czvf remotemm_backup_$(date +%F).tar.gz data/` |

---

## 5. Güvenlik ve İzolasyon Kuralları

1. **Veritabanı İzolasyonu:** SQLite veritabanı dosya tabanlıdır ve konteyner dışına yalnızca yerel `./data` hacmi üzerinden bağlanır; harici ağa doğrudan açık port barındırmaz.
2. **Konteyner Kullanıcı İzinleri:** Gateway konteyneri `root` yerine kısıtlı `node` kullanıcısıyla çalışır (`USER node`).
3. **Ters Vekil Koruması:** Dış dünyadan gelen tüm HTTP/WebSocket istekleri Nginx güvenlik başlıkları ve zaman aşımı denetimlerinden geçer.
