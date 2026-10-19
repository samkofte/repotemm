# RemoteMM (NOC Enterprise) — Mevcut Durum Analizi (CURRENT_STATE.md)
**Tarih:** 19 Ekim 2026  
**Durum:** İlk Keşif ve Kararlılık Analizi Tamamlandı  
**Doküman Sürümü:** 1.0  

---

## 1. Mimari ve Veri Akışı

RemoteMM, 3 katmanlı bir istemci-sunucu-ajan mimarisine sahiptir:

```mermaid
flowchart LR
    A["React UI (Vite / App.jsx)"] <-->|IPC window controls| B["Electron Main (main.cjs)"]
    A <-->|WebSocket + HTTP API (port 3001)| C["Node.js Gateway Server (server/index.js)"]
    C <-->|Raw TCP JSON (port 6129)| D["Python Remote Agent (py_agent.py)"]
    D <-->|IPC localhost:6131| E["Tkinter Destek Penceresi (--chat-ui)"]
```

1. **Ajan Katmanı (Python - `agent/py_agent.py`):**
   - Windows Service (`RemoteMMAgent`) veya interaktif modda çalışır.
   - SCM kontrol yöneticisi ve kullanıcı oturumu watchdog mekanizmasına sahiptir.
   - TCP 6129 portundan komut dinler, GDI32 / PIL ile ekran görüntüsü alıp JPEG base64 olarak iletir.
   - SendInput API ile uzaktan fare ve klavye girişlerini yönlendirir.
   - Tkinter arayüzünü (`--chat-ui`) kullanıcının oturumunda başlatır ve IPC (port 6131) ile çift yönlü sohbeti senkronize eder.
   - Görev listesi (`TASK_LIST`), süreç sonlandırma (`KILL_PROCESS`), dosya yönetimi (`FS_*`) ve güç yönetimi (`POWER_ACTION`) komutlarını yürütür.

2. **Sunucu/Köprü Katmanı (Node.js Gateway - `server/index.js`):**
   - Express ve WebSocket (`ws`) sunucusudur (varsayılan port 3001).
   - React arayüzü ile Python ajanları arasında çift yönlü proxy / köprü görevi görür.
   - WoL (`server/wol.js`), SMB / RPC otomatik ajan dağıtımı (`server/deployer.js`) ve filo ekran önizleme (`/api/fleet/snapshot`) uç noktalarını sunar.
   - Paket boyutu denetimi, backpressure ve bağlantı kopmasında otomatik yeniden deneme mantığı içerir.

3. **Masaüstü ve Arayüz Katmanı (Electron + React):**
   - **Electron (`electron/main.cjs`, `electron/preload.cjs`):**
     - Özel çerçevesiz pencere (frameless titlebar) yönetimi.
     - `nodeIntegration: false`, `contextIsolation: true` güvenlik ayarları devrededir.
     - Arka planda Gateway Server'ı (`server/index.js`) child process olarak çatallar (fork).
   - **React (`src/App.jsx`, Tailwind CSS):**
     - Canlı Konsol (Uzak masaüstü yayını, fare/klavye kontrolü, HUD kontrolleri).
     - Sunucu Filosu & NOC Grid (Görüntülü önizlemeler, canlı durum takibi).
     - Süreçler & Güç Yönetimi.
     - Uzak Dosya Gezgini.
     - Operasyon & Kullanıcı Sohbeti (tam sayfa ve kayan panel).
     - Otomatik Dağıtım Merkezi.

---

## 2. Giriş Noktaları ve Çalıştırma Komutları

| Bileşen | Giriş Dosyası | Komut |
|---|---|---|
| Web UI (Vite Dev) | `src/main.jsx` | `npm run dev` (Port 5173) |
| Gateway Server | `server/index.js` | `npm run server` (Port 3001) |
| Electron App | `electron/main.cjs` | `npm run electron:dev` |
| Python Agent | `agent/py_agent.py` | `python agent/py_agent.py --server` veya Windows Servisi |
| Agent PyInstaller | `agent/RemoteMM_Agent.spec` | `pyinstaller --noconfirm agent/RemoteMM_Agent.spec` |
| UI Build | `vite.config.js` | `npm run build` |
| Lint | Oxlint | `npm run lint` |

---

## 3. Özelliklerin Çalışma Durumu Matrisi

| Modül / Özellik | Durum | Açıklama |
|---|---|---|
| **Ekran Yayını (Canlı Konsol)** | ✅ Çalışıyor | 60 FPS'e kadar akıcı GDI yakalama, JPEG base64 aktarımı, auto-fit/100% ölçekleme. |
| **Giriş Kontrolü (Fare / Klavye)** | ✅ Çalışıyor | SendInput ile hassas koordinat eşleme, özel tuşlar (CAD, Win, UAC Evet/Hayır). |
| **Giriş ve Ekran Kilidi** | ✅ Çalışıyor | `LOCK_INPUT` (LowLevel hook) ve `BLACKOUT_SCREEN` (Curtain window). |
| **Ops Sohbet (Web ↔ Remote Tkinter)** | ✅ Çalışıyor | Kesintisiz sekme geçişi, Tkinter öne çıkma, Windows chime zili, kayan overlay. |
| **Dosya Yöneticisi (FS)** | ✅ Çalışıyor | Dizin listeleme, klasör oluşturma, silme, dosya indirme/yükleme (25MB sınır). |
| **Süreç Yönetimi (Tasks)** | ✅ Çalışıyor | PowerShell Get-Process ile listeleme ve taskkill ile sonlandırma. |
| **Güç Yönetimi & WoL** | ✅ Çalışıyor | UDP 7,9 WoL sihirli paketi, shutdown/reboot/sleep/lock komutları. |
| **NOC Filo Ekranı & Grid** | ✅ Çalışıyor | Port tarama, dinamik thumbnail (`capture_thumbnail`), canlı CPU/RAM/Disk/Uptime telemetrisi. |
| **Donanım Kimliği (HWID & Identity)** | ✅ Tamamlandı | BIOS UUID, CPU ID, MachineGuid ve MAC tabanlı 64-char SHA-256 parmak izi (`agent/identity.py`). |
| **Merkezi Cihaz Veritabanı (Registry)** | ✅ Tamamlandı | SQLite + yüksek performanslı bellek önbelleği, multi-tenant cihaz kaydı (`server/registry.js`). |
| **Denetim İzi & Uyumluluk (Audit Log)** | ✅ Tamamlandı | Dönen JSONL kütüğü, hassas parola/token süzgeci ve UI Denetim İzi tablosu (`server/audit.js`). |
| **Win32 Telemetri Motoru** | ✅ Tamamlandı | Pure Win32 API (GlobalMemoryStatusEx, GetDiskFreeSpaceExW, GetTickCount64, GetSystemTimes) (`agent/telemetry.py`). |
| **Çoklu Monitör Keşfi & Değişimi** | ✅ Tamamlandı | Win32 EnumDisplayMonitors ile çoklu ekran yakalama, koordinat uzayı haritalama ve HUD seçici (`agent/display.py`). |
| **Dinamik Görüntü Kalitesi** | ✅ Tamamlandı | Ağ gecikmesine uyumlu (Ultra 95%, Yüksek 88%, Dengeli 75%, Düşük 55%) dinamik kalite motoru. |
| **Otomatik Test Altyapısı** | ✅ Tamamlandı | Python unittest (10/10 passed) ve Node.js test runner (5/5 passed). |

---

## 4. Tamamlanan Geliştirme Aşamaları

1. **Aşama 1: Güvenlik Çekirdeği, Cihaz Kimliği ve Denetim İzi**
   - SHA-256 donanım parmak izi (`HWID`) ve `tok_dev_` kimlik anahtarları üretildi ve saklandı.
   - Çok kiracılı merkezi SQLite veritabanı (`data/remotemm_enterprise.db`) ve `/api/devices` API'si oluşturuldu.
   - ISO 27001 uyumlu döner JSONL denetim kütüğü ve `/api/audit/logs` API'si entegre edildi.
   - React arayüzüne Tab 7: "Denetim İzi (Audit Trail)" sekmesi eklendi.

2. **Aşama 2: NOC Grid, Canlı Telemetri ve Küçük Resim (Thumbnail) Akışı**
   - Pure Win32 API çağrılarıyla anlık CPU, RAM, Disk, Uptime ve Lock toplayan `agent/telemetry.py` yazıldı.
   - Ağ trafiğini korumak amacıyla büyük filolara yönelik düşük frekanslı `capture_thumbnail` ve `SET_STREAM_MODE` eklendi.
   - Gateway WebSocket proxy'sine `TELEMETRY_UPDATE` ve `NOC_THUMBNAIL` paket yönlendirmesi eklendi.
   - React Sunucular (Fleet) Grid kartlarına anlık CPU %, kullanılan/toplam RAM, boş disk alanı ve kilit durumu göstergeleri bağlandı.

3. **Aşama 3: Gelişmiş Çoklu Monitör & Dinamik Görüntü Kalitesi**
   - Win32 API ile çoklu monitör donanım keşif motoru (`agent/display.py`) geliştirildi.
   - Teknisyenin tüm ekranları (sanal masaüstü) veya hedef tekil monitörü seçebilmesi sağlandı (`SELECT_MONITOR`).
   - `MOUSEEVENTF_VIRTUALDESK` desteğiyle fare koordinat uzayının seçili monitöre piksel piksel doğru eşlenmesi sağlandı.
   - HUD kontrol çubuğuna Monitör Seçici ve Dinamik Yayın Kalitesi seçicisi yerleştirildi.

4. **Aşama 4: Sistem Operasyonları & Güvenli Dosya/Servis Yönetimi**
   - Dosya indirme ve yükleme işlemlerinde SHA-256 bütünlük kontrolü (tamper detection) entegre edildi.
   - `agent/py_agent.py` içine Windows servislerini listeleme (`handle_service_list`) ve güvenli servis eylemleri (`handle_service_action`: start, stop, restart) eklendi.
   - `server/index.js` üzerinde `FS_EXEC`, `FS_DELETE`, `FS_UPLOAD`, `KILL_PROCESS` ve `SERVICE_ACTION` eylemleri için ISO 27001 uyumlu denetim izi yakalama eklendi.
   - React arayüzünde (Tab 3) "Aktif Süreçler" ve "Windows Servisleri" alt sekmeleri, servis arama/filtreleme ve Başlat/Durdur/Yeniden Başlat kontrolleri tamamlandı.

5. **Aşama 5: Kurumsal Ölçek ve Dağıtım (Sıradaki Aşama)**
   - Toplu kurulum için MSI paketi, Active Directory Group Policy (GPO) dağıtım betikleri ve sessiz kurulum yapılandırması.


