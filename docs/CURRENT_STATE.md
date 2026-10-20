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
| **KVKK Rıza Modalı (Consent)** | ✅ Tamamlandı | Win32 `MessageBoxTimeoutW` ile 30 sn zaman aşımı kontrollü kullanıcı onay akışı. |
| **RBAC Rol & Erişim Denetimi** | ✅ Tamamlandı | SUPER_ADMIN, NOC_OPERATOR, HELPDESK ve salt-okunur AUDITOR rol koruma filtreleri. |
| **Mevzuat Denetim Dışa Aktarımı** | ✅ Tamamlandı | RFC 4180 CSV ve JSON denetim izi dışa aktarımı (`/api/audit/export`). |
| **WiX MSI Kurumsal Paket** | ✅ Tamamlandı | Sessiz ve parametrik Active Directory / Intune MSI dağıtım şablonu (`installer/Product.wxs`). |
| **Auto-Rollback State Machine** | ✅ Tamamlandı | SHA-256 hash doğrulaması, `.bak` yedeği ve arıza durumunda otomatik geri alma (`agent/updater.py`). |
| **Sıfır-Güven (Zero-Trust) Sınırları** | ✅ Tamamlandı | Path traversal, 25MB tampon taşması ve çekirdek süreç koruma filtreleri. |
| **Uçtan Uca (E2E) TCP Entegrasyonu** | ✅ Tamamlandı | Canlı TCP el sıkışma, dinamik stream geçişleri, PING/PONG gecikme ve sohbet döngüsü. |
| **Otomatik Test Altyapısı** | ✅ Tamamlandı | Python unittest (27/27 passed) ve Node.js test runner (7/7 passed) — Toplam 34 test %100 Başarılı. |

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

5. **Aşama 5: Kurumsal Ölçek ve Dağıtım (TAMAMLANDI)**
   - Ajan komut satırı arayüzü (`--install`, `--uninstall`, `--status`, `--version`) geliştirildi.
   - Active Directory GPO & Microsoft Intune otomatik dağıtım betiği (`scripts/deploy-gpo.ps1`) hazırlandı.
   - Sessiz kurumsal batch yükleyicisi (`scripts/install-agent.bat`) ve kaldırıcı (`scripts/uninstall-agent.bat`) eklendi.
   - Uç nokta sağlık denetim ve teşhis betiği (`scripts/verify-agent.ps1`) oluşturuldu.
   - Node.js Gateway sunucusuna `/scripts` statik dağıtım köprüsü ve dinamik GPO URL üreticisi eklendi.
   - React arayüzünde Tab 6 (Ajan Dağıtım Merkezi) 4 kurumsal dağıtım moduyla güncellendi.
   - Tüm aşamalar (Aşama 0'dan Aşama 5'e) %100 test başarı oranıyla tamamlandı ve GitHub ana dalına gönderildi.

6. **Aşama 6: Ticarileşme, KVKK / ISO 27001 Uyumluluğu, RBAC ve MSI Paketleme (TAMAMLANDI)**
   - KVKK 12. Madde gereğince Win32 `MessageBoxTimeoutW` ile 30 saniyelik şeffaf kullanıcı rıza akışı (`REQUEST_CONSENT`) hayata geçirildi.
   - Gateway üzerinde `SUPER_ADMIN`, `NOC_OPERATOR`, `HELPDESK` ve `AUDITOR` rolleri işletildi. Denetçi rolünde tüm kontrol (fare/klavye/dosya/güç) yetkileri kısıtlandı ve ihlal girişimleri loglandı.
   - Denetim izlerinin resmi kurumlara raporlanabilmesi için CSV ve JSON formatında dışa aktarma API'si (`/api/audit/export`) ve UI entegrasyonu tamamlandı.
   - Kurumsal Active Directory GPO, Intune ve SCCM dağıtımları için WiX MSI paket tanımı (`installer/Product.wxs`) ve PowerShell derleme otomasyonu (`installer/build-msi.ps1`) eklendi.

7. **Aşama 7: Auto-Rollback Durum Makinesi, Güvenlik Sınırları ve E2E Test Paketi (TAMAMLANDI)**
   - Şartname Bölüm 7.2 gereğince SHA-256 doğrulama, `.bak` yedeği ve arıza durumunda otomatik eski sürüme geri dönen `agent/updater.py` yazıldı.
   - `tests/test_security_bounds.py` ile SAM/SYSTEM traversal atakları, 25MB tampon taşması ve çekirdek süreç koruma filtreleri doğrulandı.
   - `tests/test_e2e_connection.py` ile gerçek TCP istemcisi üzerinden el sıkışma, akış modu değişimi (NOC thumbnail vs tam ekran) ve sohbet döngüsü test edildi.

8. **Aşama 8: Winlogon & Secure Desktop Geçişi, NOC Sağlık Eşikleri ve Uzak Pano Senkronizasyonu (TAMAMLANDI)**
   - **Winlogon & UAC Secure Desktop Geçişi (Bölüm 5.1 & 5.2):** `user32.SetProcessDPIAware()` ile yüksek DPI koordinat sapması engellendi. `OpenInputDesktop` / `SetThreadDesktop` sorgu periyodu 0.5s'ye indirilerek BitBlt arıza anında anında failover masaüstü geçişi sağlandı.
   - **NOC Sağlık Eşikleri ve Otomatik Alarm Motoru (Bölüm 4.2):** CPU > %90 (3 periyot peş peşe `ALERT_HIGH_CPU`), Disk < 10GB (`ALERT_LOW_DISK`), RAM > %95 (`ALERT_HIGH_MEMORY`) ve 45 saniye sessizlik zaman aşımı (`ALERT_OFFLINE`) otomatik tespit edilerek filo kartlarında ve arama çubuğunda "🚨 Alarmlı Sunucular" filtresi ile gösterildi.
   - **Çift Yönlü Uzak Pano Senkronizasyonu (Bölüm 5.3):** Win32 `OpenClipboard`, `GetClipboardData(CF_UNICODETEXT)` ve `GlobalAlloc(GMEM_MOVEABLE)` ile operatör ve hedef makine arasında Unicode ve emoji destekli, 64KB sınır kontrollü metin kopyalama/yapıştırma ve canlı konsol HUD menüsü tamamlandı.

9. **Aşama 9: RMM2 İkili Ağ Çerçeveleme (Binary Framing), Saf Win32 Advapi32 Servis Kontrolü ve Yönlendirmeli WoL (TAMAMLANDI)**
   - **RMM2 İkili Ağ Çerçeveleme Protokolü (Bölüm 3.2):** `agent/rmm2_protocol.py` (Python) ve `server/rmm2_codec.js` (Node.js) üzerinde 12 baytlık ikili başlık (`MAGIC: 0x524D4D32 = "RMM2"`, `PKT_TYPE`, `FLAGS`, `RESERVED`, `PAYLOAD_LENGTH`) kodlayıcı/çözücü motoru ve TCP akış parçalanmasını yöneten durum bilgili `RMM2StreamParser` uygulandı. Base64 görüntü taşıma yükü ortadan kaldırılarak sıfır kopyalı ham ikili aktarım sağlandı.
   - **Saf Win32 Advapi32 Servis Kontrol Motoru (Bölüm 6.1):** Windows servisleri için harici shell (`cmd.exe /c net start/stop`) ve yavaş PowerShell süreçleri tamamen terk edildi. Doğrudan `advapi32.OpenSCManagerW`, `OpenServiceW`, `StartServiceW`, `ControlService(STOP)` ve `EnumServicesStatusExW` çağrılarıyla mikrosaniye hızında servis yönetimi (`agent/service_manager.py`) kodlandı. `RemoteMMAgent`, `RpcSs`, `EventLog` gibi kritik çekirdek servisler için koruma kalkanı işletildi.
   - **Yönlendirmeli (Subnet-Directed) Wake-on-LAN (Bölüm 4.1 & 6):** `server/wol.js` içine `calculateDirectedBroadcast()` fonksiyonu eklenerek CIDR ve alt ağ maskelerine göre hedef alt ağ yayını (örn: `192.168.10.255`, `172.16.255.255`) ve doğrudan unicast desteğiyle VLAN/switch engelleri aşıldı.
   - 31 Python ve 10 Node.js otomatik testi olmak üzere toplam 41 test %100 başarıyla tamamlandı.
