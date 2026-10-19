# RemoteMM Enterprise — Kapsamlı Kurumsal Ürün, Mühendislik ve Ticari Dağıtım Şartnamesi
**Doküman Kodu:** RMM-ENT-SPEC-2026-V1  
**Tarih:** 19 Ekim 2026  
**Sürüm:** 1.0.0-ENTERPRISE-CORE  
**Hedef Regülasyonlar:** KVKK (Türkiye), GDPR (AB), ISO/IEC 27001:2022, SOC 2 Type II, HIPAA Güvenlik Kuralı  
**Hedef Pazar:** Kurumsal BT Departmanları, MSP (Yönetilen Hizmet Sağlayıcıları), Savunma/Finans/Sağlık Ağları  

---

## 1. STRATEJİK HEDEF VE ÜRÜN FELSEFESİ

### 1.1 "Uzak Masaüstü" Değil, "NOC & Uç Nokta Yönetim Platformu"
Klasik tüketici uzak masaüstü programları (TeamViewer, AnyDesk) iki bilgisayar arasında geçici ve kontrolsüz oturum açmayı hedefler. **RemoteMM Enterprise** ise bir şirketin tüm bilgisayarlarını envanterleyen, sağlık durumlarını (CPU, RAM, Disk, Ağ) anlık izleyen, gerektiğinde arka planda kullanıcıyı rahatsız etmeden sistem hizmetlerini onaran ve canlı destek sunan merkezi bir **Kurumsal IT Operasyon Platformudur.**

### 1.2 Ürünün Ticari Değeri (Value Proposition)
1. **Sıfır Güven (Zero-Trust) Uç Nokta İzolasyonu:** IP adresi bilmek cihaza bağlanmaya yetmez; cihaz tokenı, operatör rolü ve cihaz onay durumu doğrulanmalıdır.
2. **Denetlenebilirlik (CISO Dostu):** "Kim, ne zaman, hangi cihazda ne yaptı?" sorusuna tek tıkla yasal geçerliliği olan, tahrif edilemez log raporu üretir.
3. **Müşteri Ayrımı (Multi-Tenancy):** MSP firmaları tek sunucu üzerinden 50 farklı müşterisini (Firma A, Firma B) birbirinin verisini ve cihazını görmeden izler ve yönetir.
4. **Hafif Ağ Ayak İzi (Low Bandwidth NOC):** 500 bilgisayar aynı anda bağlıyken ağ omurgasını felç etmeyen iki kademeli akıllı görüntü mimarisi.

---

## 2. DETAYLI 4 KATMANLI MİMARİ VE BİLEŞEN ŞARTNAMESİ

```
+--------------------------------------------------------------------------------------------------------+
|                                  KATMAN 1: OPERATÖR & YÖNETİCİ ARAYÜZÜ                                 |
|                                         (React 19 + Electron 33)                                       |
|  [NOC Fleet Grid]   [Cihaz Detay / Envanter]   [Canlı Destek Konsolu]   [Denetim İzleri]   [Ayarlar]   |
+---------------------------------------------------┬----------------------------------------------------+
                                                    │ WSS / HTTPS (JWT + RBAC Yetki Başlığı)
+---------------------------------------------------▼----------------------------------------------------+
|                                  KATMAN 2: MERKEZİ SUNUCU & GATEWAY KÜMESİ                             |
|                                              (Node.js / Express)                                       |
|  ┌───────────────────────┐  ┌────────────────────────┐  ┌───────────────────────┐  ┌────────────────┐  │
|  │  Auth & Token Motoru  │  │  Multi-Tenant Registry  │  │  Audit Logger Engine  │  │  Proxy Gateway │  │
|  │  (JWT / API Keys)     │  │  (Cihaz Kimlik Doğrul.)│  │  (JSONL / SQLite DB)  │  │  (WSS <-> TCP) │  │
|  └───────────────────────┘  └────────────────────────┘  └───────────────────────┘  └────────────────┘  │
+---------------------------------------------------┬----------------------------------------------------+
                                                    │ Şifreli TCP Soket (Port 6129) + Token El Sıkışması
+---------------------------------------------------▼----------------------------------------------------+
|                                  KATMAN 3: WINDOWS AJAN SERVİSİ (SYSTEM)                               |
|                                       (Session 0 / py_agent.py --service)                              |
|  • Watchdog Denetçisi (Oturum Değişimi & Çökme İyileştirme)  • Donanım Envanter Toplayıcı (WMI/PS)     |
|  • Güvenli Güncelleme Motoru (SHA-256 Doğrulama + Rollback)   • İzinli Sistem Operasyonları Yöneticisi │
+---------------------------------------------------┬----------------------------------------------------+
                                                    │ Yerel IPC (TCP localhost:6131 / Windows Named Pipe)
+---------------------------------------------------▼----------------------------------------------------+
|                             KATMAN 4: ETKİLEŞİMLİ KULLANICI OTURUMU YARDIMCISI                         |
|                                     (Session 1, 2... / py_agent.py --chat-ui)                          |
|  • GDI / PIL Yüksek Hızlı Ekran Yakalama                     • SendInput Fare/Klavye Yönlendirici      |
|  • Kullanıcı Onay Modalı (Consent Prompt - KVKK)             • Masaüstü Destek Oturumu Bilgi Çubuğu    |
+--------------------------------------------------------------------------------------------------------+
```

---

## 3. VERİ SÖZLEŞMELERİ VE PROTOKOL ŞARTNAMESİ

Tüm iletişim, başlığı ve gövdesi açıkça tanımlanmış JSON paketleri üzerinden tek satırlık `\n` sonlandırıcılı TCP/WebSocket mesajlarıyla yürütülür.

### 3.1 Cihaz Kayıt ve El Sıkışma Paketi (`DEVICE_REGISTER / HANDSHAKE`)
Ajan sunucuya bağlandığında ilk olarak donanım parmak izini ve tokenını iletir:
```json
{
  "type": "DEVICE_HANDSHAKE",
  "protocolVersion": "2.0.0",
  "tenantId": "tenant_default",
  "hwid": "SHA256:7b9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c",
  "deviceToken": "tok_dev_live_98a7b6c5d4e3f2",
  "systemInfo": {
    "hostname": "FINANS-PC01",
    "os": "Windows 11 Pro 64-bit (10.0.26200)",
    "username": "ahmet.yilmaz",
    "cpu": "13th Gen Intel(R) Core(TM) i7-13700",
    "totalRamBytes": 17179869184,
    "primaryMac": "00:15:5D:01:68:01",
    "agentVersion": "RemoteMM Enterprise v5.0.0"
  },
  "timestamp": 1792439400000
}
```

### 3.2 Sunucu Yetki ve Kabul Yanıtı (`HANDSHAKE_RESPONSE`)
```json
{
  "type": "HANDSHAKE_RESPONSE",
  "status": "APPROVED",
  "assignedDeviceId": "dev_finans_01",
  "heartbeatIntervalSec": 15,
  "snapshotIntervalSec": 10,
  "allowedCapabilities": ["SCREEN_VIEW", "SCREEN_CONTROL", "TASK_MANAGER", "FILE_EXPLORER", "POWER_MGMT"]
}
```

### 3.3 Canlı Heartbeat (Nabız) Sinyali (`DEVICE_HEARTBEAT`)
Ağ tüketimini sıfıra yakın tutmak için her 15 saniyede bir iletilen minik paket:
```json
{
  "type": "DEVICE_HEARTBEAT",
  "deviceId": "dev_finans_01",
  "cpuUsagePercent": 14.2,
  "usedRamBytes": 6871947673,
  "freeDiskBytes": 128849018880,
  "activeUser": "ahmet.yilmaz",
  "isLocked": false,
  "uptimeSeconds": 86420,
  "timestamp": 1792439415000
}
```

### 3.4 Denetim İzi (Audit Log) Sözleşmesi
Sunucuda tahrif edilemez şekilde saklanan operasyon kaydı:
```json
{
  "eventId": "aud_88291a9f",
  "tenantId": "tenant_default",
  "timestamp": "2026-10-19T22:20:00.000Z",
  "operatorUser": "admin@remotemm.local",
  "operatorIp": "192.168.1.105",
  "targetDeviceId": "dev_finans_01",
  "targetHost": "172.17.130.182",
  "actionCategory": "SUPPORT_SESSION",
  "actionName": "REMOTE_DESKTOP_START",
  "requestedParameters": { "mode": "FULL_CONTROL", "quality": 88 },
  "executionResult": "SUCCESS",
  "operatorNotes": "Muhasebe programı çökme sorunu incelendi"
}
```

---

## 4. AYRINTILI MÜHENDİSLİK FAZLARI VE UYGULAMA ADIMLARI

---

### FAZ 1: Güvenlik Çekirdeği, Cihaz Kimliği ve Yetkilendirme (P0)

#### 1.1 Amaç ve Gerekçe
Mevcut kod doğrudan IP ve Port üzerinden herhangi bir doğrulama olmaksızın soket açmaktadır. Kurumsal ağlarda bu durum kabul edilemez. Bir makine IP değiştirse bile platform o cihazı tanımalı, onaylanmamış yabancı cihazların verisi panele yansıtılmamalıdır.

#### 1.2 Yapılacak Değişiklikler
1. **Donanım Kimlik Motoru (`agent/identity.py`):**
   - Windows Registry (`HKLM\HARDWARE\DESCRIPTION\System\BIOS`) ve `wmic csproduct get uuid` üzerinden kalıcı donanım parmak izi (HWID) türetilir.
   - Üretilen kimlik şifreli biçimde `C:\ProgramData\RemoteMM\identity.dat` içine yazılır.
2. **Cihaz Doğrulama ve Token Yöneticisi (`server/registry.js`):**
   - İlk bağlanan cihaz "PENDING" durumuna alınır. Yönetici panelden "Onayla" demeden ekranı açılamaz (Kurumsal katı güvenlik).
   - Önceden oluşturulmuş şirket anahtarıyla (`ENROLLMENT_TOKEN`) gelen cihazlar otomatik onaylanır.
3. **Rol Tabanlı Erişim Kontrolü (RBAC Modülü):**
   - `SUPER_ADMIN`: Tüm şirketler, tüm cihazlar, ajan dağıtımı, denetim loglarını inceleme.
   - `NOC_OPERATOR`: Filo ekranını izleme, uyarıları görme, canlı konsola bağlanma.
   - `HELPDESK`: Yalnızca izin verilen belirli cihazlara bağlanma, sohbet etme, kullanıcı izniyle müdahale etme.
   - `AUDITOR`: Canlı kontrol yapamaz; yalnızca işlem geçmişi ve kayıtları raporlar.
4. **Denetim Günlüğü Motoru (`server/audit.js`):**
   - Yapılandırılmış JSONL ve SQLite veritabanı motoru kurulur.
   - Bağlanma, kopma, dosya indirme/yükleme, süreç sonlandırma ve güç eylemleri saniyesi saniyesine kaydedilir.

---

### FAZ 2: NOC Grid ve Ölçeklenebilir Filo İzleme (P1)

#### 2.1 Amaç ve Gerekçe
50 veya 500 cihaz aynı anda açıkken her cihazdan 60 FPS video çekmek ağ bant genişliğini ve sunucu işlemcisini tüketir. Profesyonel NOC yaklaşımı, hiyerarşik ve iki aşamalı bir görüntüleme gerektirir.

#### 2.2 Yapılacak Değişiklikler
1. **İki Kademeli Akıllı Görüntüleme Mimarisi:**
   - **Kademe 1 (NOC Fleet Modu):** Cihazlar video stream etmez. Ajan her 8-12 saniyede bir 320x180 çözünürlüğünde hafif bir JPEG snapshot üretir. Sunucu bu snapshot'ları önbellekler. Grid ekranında saniyede yalnızca birkaç kilobayt tüketilir.
   - **Kademe 2 (Canlı Konsol Modu):** Yalnızca teknisyenin tıkladığı makine 60 FPS / düşük gecikmeli interaktif akışa geçer.
2. **Envanter ve Donanım Önbelleği:**
   - Cihazın toplam RAM miktarı, anakart modeli ve işletim sistemi sürümü gibi değişmeyen bilgiler her saniye WMI'dan sorulmaz. İlk el sıkışmada alınıp önbelleklenir.
   - Dinamik veriler (CPU %, RAM %, Boş Disk %) heartbeat paketiyle saniyeler içinde hafifçe güncellenir.
3. **Gelişmiş Filtreleme ve Etiketleme (Tagging):**
   - Cihazlara dinamik etiketler verilir: `#Muhasebe`, `#VIP`, `#Server`, `#WinServer2022`, `#Ankara-Ofis`.
   - Tek tıkla sadece sorunlu cihazları ("Yüksek CPU", "Düşük Disk", "Çevrimdışı") listeleyen akıllı NOC filtreleri.

---

### FAZ 3: Canlı Uzaktan Destek ve Şeffaf Oturum Yönetimi (P2)

#### 3.1 Amaç ve Gerekçe
Destek oturumu açıldığında karşı kullanıcının bundan haberdar olması kurumsal etik ve KVKK zorunluluğudur. Ayrıca ekran kilitlendiğinde veya UAC penceresi açıldığında bağlantının kopmaması gerekir.

#### 3.2 Yapılacak Değişiklikler
1. **Session 0 ↔ Session > 0 Mimari Ayrımı:**
   - Windows Servisi (`py_agent.py --service`) arka planda izole Session 0'da çalışır; asla doğrudan ekrana çizim yapmaz.
   - Kullanıcı masaüstü açıldığında, servis ilgili oturumun içine `RemoteMM_Agent.exe --session-worker` sürecini başlatır.
   - Masaüstü kilitlendiğinde (`LockWorkstation`), işçi süreci güvenli `Winlogon` masaüstüne geçer. UAC çıktığında onay butonuna erişim sağlanır.
2. **Kullanıcı Şeffaflığı ve Onay Çubuğu:**
   - Karşı makinede sağ alt köşede zarif bir kurumsal çubuk belirir: *"RemoteMM Canlı Destek — Teknisyen: [İsim] bağlı"*.
   - Kurumsal politika gerektiriyorsa (KVKK Modu), teknisyen bağlanırken karşı ekranda 30 saniyelik geri sayımla *"Teknisyen bilgisayarınıza bağlanmak istiyor. Kabul ediyor musunuz?"* penceresi açılır.
3. **Ekran Oranını Koruyan Akıllı Giriş (Aspect-Ratio Math):**
   - Hedef makine 4K veya çift monitör olsa dahi, operatörün ekranında siyah boşluklara tıklandığında koordinat kayması yaşanmaması için normalize koordinat matrisi (`xPercent`, `yPercent`) DPI farkından arındırılır.

---

### FAZ 4: Sistem Operasyonları ve Güvenli Dosya Transferi (P3)

#### 4.1 Amaç ve Gerekçe
PowerShell veya CMD satırına rastgele string basmak büyük bir siber güvenlik açığıdır (Command Injection). Kurumsal yazılımlar yalnızca önceden tanımlanmış parametrik eylemleri kabul eder.

#### 4.2 Yapılacak Değişiklikler
1. **İzinli Eylem Kataloğu (Whitelisted Actions Only):**
   - `CMD_POWER`: `shutdown`, `reboot`, `sleep`, `hibernate`, `lock`, `abort`.
   - `CMD_PROCESS_KILL`: `pid` parametresi alır; sistem kritik işlemler (csrss, winlogon, lsass) sonlandırılamaz (Hardcoded Kernel Protection).
   - `CMD_SERVICE_CONTROL`: `start`, `stop`, `restart` işlemleri servis adı parametresiyle çalışır.
2. **Güvenli Dosya Transfer Motoru:**
   - Chunk tabanlı (her parça 256 KB) veri aktarımı ve yükleme barı.
   - SHA-256 bütünlük kontrolü: Gönderilen dosya hedefte yazıldıktan sonra hash değeri hesaplanır; tutmazsa dosya silinir ve hata verilir.
   - Dizin sınırlaması (Path Traversal Koruması): `..\..\Windows` gibi kök dizin manipülasyonları reddedilir.
3. **Gelişmiş Wake-on-LAN (WoL):**
   - Alt ağ (Subnet) hedefli Magic Packet gönderimi ile farklı VLAN'lardaki kapalı makinelerin de uyandırılması.

---

### FAZ 5: Kurumsal Dağıtım, MSI Paketleme ve Güncelleme (P4)

#### 5.1 Amaç ve Gerekçe
Bir IT yöneticisi 1.000 makineye tek tek program kuramaz. Active Directory GPO veya Microsoft Intune üzerinden uzaktan sessiz kurulum yapılabilmelidir.

#### 5.2 Yapılacak Değişiklikler
1. **Standart Windows Installer (MSI):**
   - WiX Toolset kullanılarak oluşturulacak kurumsal `.msi` paketi.
   - Parametrik sessiz kurulum:
     ```cmd
     msiexec /i RemoteMM_Agent.msi /quiet /qn SERVER="https://noc.sirket.com" TENANT="ACME" TOKEN="tok_secret_9988"
     ```
2. **Hata Korumalı Kendini Güncelleme (Auto-Update with Rollback):**
   - Yeni ajan binary'si sunucudan indirilir.
   - Hash doğrulaması yapılır.
   - Windows Servisi durdurulur, binary değiştirilir ve servis başlatılır.
   - 30 saniye içinde sunucuya "Güncelleme Başarılı" sinyali iletilemezse, watchdog eski binary'yi (`RemoteMM_Agent.bak`) geri yükleyip servisi eski sürümle ayağa kaldırır (Otomatik Kurtarma).

---

## 5. TİCARİLEŞTİRME VE LİSANSLAMA MİMARİSİ

RemoteMM Enterprise, farklı sektörlerin ihtiyaçlarına göre 3 farklı kurumsal lisans modeliyle pazarlanır:

```
+-------------------------------------------------------------------------------------------------------+
|                                  LİSANSLAMA VE PAKETLEME MODELİ                                       |
+-----------------------------------+-----------------------------------+-------------------------------+
|         1. SAAS CLOUD             |            2. MSP PRO             |     3. ENTERPRISE ON-PREM     |
|   (KOBİ & Büyüyen İşletmeler)     |     (Bilişim & IT Şirketleri)     |    (Banka, Kamu, Hastane)     |
+-----------------------------------+-----------------------------------+-------------------------------+
| • Uç nokta (Cihaz) başı aylık     | • Eşzamanlı teknisyen lisansı     | • Yıllık / Sınırsız Lisans    |
|   ($1.50 - $2.50 / cihaz / ay)    |   ($39 - $59 / teknisyen / ay)    |   (Özel kurumsal teklif)      |
| • Bulut barındırmalı Gateway      | • Sınırsız cihaz desteği          | • Tamamen kurum içi (Offline) |
| • Otomatik yedekleme & güncelleme | • Multi-Tenant (Müşteri ayrımı)   | • PostgreSQL & Active Directory|
| • 30 günlük denetim logu          | • White-Label (Özel Logo & Renk)  | • Sınırsız denetim log arşivi |
+-----------------------------------+-----------------------------------+-------------------------------+
```

---

## 6. GÜNLÜK GELİŞTİRME DİSİPLİNİ VE KALİTE GÜVENCESİ

Her mühendislik turunda şu 6 kural tavizsiz uygulanacaktır:
1. **Geriye Uyumluluk:** Yeni eklenen modül çalışan eski canlı ekran veya soket akışını bozmayacaktır.
2. **Kodlama Sınırları:** Mantık ve ajan için Python, Gateway ve merkez için Node.js, arayüz için React, masaüstü kabuğu için Electron kullanılacaktır.
3. **Otomatik Test Zorunluluğu:** Yazılan her modül için `tests/` klasörüne unit test eklenecek ve fiilen başarıyla çalıştırılacaktır.
4. **Gerçek Sonuç Raporlama:** Test sonuçları doğrudan `docs/TEST_REPORT.md` dosyasına işletilecektir.
5. **Durum Belgeleme:** Mevcut çalışan fonksiyonlar `docs/CURRENT_STATE.md` içinde güncel tutulacaktır.
6. **Hassas Veri Yasağı:** Kod içine asla sabit IP, parola, token veya gizli anahtar gömülmeyecektir.
