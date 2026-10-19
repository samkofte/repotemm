# RemoteMM Enterprise — Nihai Kurumsal Mühendislik ve Sistem Mimarisi Şartnamesi (The Engineering Bible)
**Belge No:** RMM-ENG-BIBLE-2026-V1  
**Tarih:** 19 Ekim 2026  
**Sürüm:** 1.0.0-PRO-DEEP  
**Hedef Regülasyon ve Standartlar:** KVKK (Türkiye), GDPR (AB), ISO/IEC 27001:2022, SOC 2 Type II, HIPAA Security Rule, FIPS 140-3  
**Hedef Dağıtım Türü:** Active Directory GPO, Microsoft Intune, SCCM, Sessiz MSI, Bağımsız Servis Dağıtımı  

---

## 1. STRATEJİK HEDEF VE ÇALIŞMA PRENSİPLERİ

RemoteMM Enterprise, tüketici seviyesindeki uzak masaüstü yazılımlarından farklı olarak, sıfır güven (Zero-Trust) mimarisi üzerine inşa edilmiş, tam denetlenebilir ve ölçeklenebilir bir **NOC (Network Operations Center) ve Uç Nokta Yönetim Platformu**dur.

### 1.1 Temel Tasarım İlkeleri
1. **Asla Güvenme, Her Zaman Doğrula:** Bir istemcinin yerel ağda olması veya IP adresinin bilinmesi erişim için yeterli değildir. Her cihaz ve operatör kriptografik anahtarlarla doğrulanır.
2. **Session 0 İzolasyonu:** Windows Servisi asla doğrudan grafik arayüzüne çizim yapmaz; etkileşimli işlemler daima kullanıcının oturumunda çalışan yardımcı süreç üzerinden yürütülür.
3. **Parametrik Komut Güvenliği (No Raw Shells):** Komut satırına rasgele metin enjeksiyonu yasaktır; sistem operasyonları önceden izin verilmiş, tip kontrollü API sözleşmeleriyle çalışır.
4. **Tahrif Edilemez Denetim İzi:** Hangi teknisyenin hangi saniyede hangi komutu verdiği veya dosya indirdiği silinemez şekilde mühürlenir.
5. **Hafif Ağ Ayak İzi:** 1.000 makine aynı anda bağlandığında ağ tıkanıklığı yaşanmaması için iki kademeli (Grid Snapshot vs Canlı Akış) veri iletimi uygulanır.

---

## 2. AŞAMA AŞAMA GELİŞTİRME VE MİMARİ FAZLARI

Aşağıdaki fazlar sırayla uygulanmalı; bir fazın testleri ve güvenlik gereksinimleri tamamlanmadan sonraki faza geçilmemelidir.

```
+--------------------------------------------------------------------------------------------------------------------+
|                                         AŞAMALI MÜHENDİSLİK YOL HARİTASI                                           |
+-------------------+-------------------+-------------------+-------------------+-------------------+----------------+
|  AŞAMA 1 (GÜVENLİK│  AŞAMA 2 (NOC &   │  AŞAMA 3 (CANLI   │  AŞAMA 4 (SİSTEM  │  AŞAMA 5 (KURUMSAL│  AŞAMA 6       |
|  & KİMLİK MOTORU) │  ENVANTER GRIDİ)  │  DESTEK MOTORU)   │  OPERASYONLARI)   │  DAĞITIM & MSI)   │  (TİCARİLEŞME) |
+-------------------+-------------------+-------------------+-------------------+-------------------+----------------+
| • HWID Üretimi    | • 2 Kademeli Akış │ • Win32 GDI Motoru| • İzinli Aksiyon  | • WiX MSI Paketi  | • Çoklu Kiracı |
| • Device Token    | • UDP/TCP Nabız   | • Secure Desktop  | • SHA-256 Dosya   | • Auto-Rollback   | • RBAC & Lisans|
| • SQL Şemaları    | • Statik Önbellek │ • DPI Ölçekleme   | • WoL Subnet      | • SCM İyileştirme | • Raporlama    |
| • JSONL Audit Log │ • Eşik Uyarıları  | • Şeffaf Destek   | • Path Traversal  | • Intune / GPO    | • White-Label  |
+-------------------+-------------------+-------------------+-------------------+-------------------+----------------+
```

---

## 3. AŞAMA 1: GÜVENLİK ÇEKİRDEĞİ, VERİTABANI ŞEMALARI VE PROTOKOL

### 3.1 Donanım Parmak İzi (Hardware ID - HWID) Türetme Algoritması
Her Windows istemcisi kurulduğunda aşağıdaki donanım öğelerinden SHA-256 özeti türeterek benzersiz bir kimlik oluşturur:
$$\text{HWID} = \text{SHA256}(\text{SMBIOS UUID} \parallel \text{CPU ProcessorID} \parallel \text{Motherboard Serial} \parallel \text{Primary MAC})$$

* **Win32 Kaynakları:**
  - `HKLM\HARDWARE\DESCRIPTION\System\BIOS\SystemManufacturer`
  - `HKLM\HARDWARE\DESCRIPTION\System\BIOS\SystemProductName`
  - `HKLM\HARDWARE\DESCRIPTION\System\BIOS\SystemFamily`
  - `HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0\Identifier`
* **Depolama Yeri:** Windows DPAPI ile şifrelenmiş biçimde:  
  `C:\ProgramData\RemoteMM\identity.dat`

### 3.2 İkili Ağ Çerçeveleme Protokolü (Binary Network Framing)
Ağdaki tüm TCP iletişimleri, tampon taşmalarını ve parçalı paket gecikmelerini önlemek amacıyla kesin başlık yapısına sahiptir:

```
0                   1                   2                   3
0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       MAGIC (0x524D4D32 = "RMM2")             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  PKT_TYPE (1B)| FLAGS (1B)    |      RESERVED (2B)            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       PAYLOAD_LENGTH (4B Big-Endian)          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       PAYLOAD_DATA (Variable Length)          |
|                       ...                                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

* `PKT_TYPE` Tanımları:
  - `0x01`: `HANDSHAKE_REQ` (Ajan -> Sunucu)
  - `0x02`: `HANDSHAKE_RESP` (Sunucu -> Ajan)
  - `0x03`: `HEARTBEAT` (Ajan -> Sunucu, her 15 sn)
  - `0x10`: `SCREEN_FRAME` (JPEG/Binary Video Karesi)
  - `0x11`: `MOUSE_INPUT` (Normalize Koordinat ve Tuş Eylemi)
  - `0x12`: `KEYBOARD_INPUT` (Sanal Tuş Kodu ve Bayrakları)
  - `0x20`: `FILE_CHUNK` (256 KB Parçalı Dosya)
  - `0x30`: `SYSTEM_ACTION` (Yetkili Sistem Komutu)
  - `0x40`: `CHAT_MESSAGE` (Kullanıcı & Operatör Mesajı)

### 3.3 Veritabanı İlişkisel Şemaları (PostgreSQL / SQLite DDL)

```sql
-- 1. Şirket / Müşteri (Tenants)
CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    enrollment_token VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- 2. Operatörler ve Roller (RBAC)
CREATE TABLE IF NOT EXISTS operators (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) REFERENCES tenants(id),
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'NOC_OPERATOR', 'HELPDESK', 'AUDITOR')),
    is_mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_secret VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Yönetilen Cihazlar (Devices)
CREATE TABLE IF NOT EXISTS devices (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) REFERENCES tenants(id),
    hwid VARCHAR(64) NOT NULL UNIQUE,
    hostname VARCHAR(128) NOT NULL,
    primary_ip VARCHAR(45) NOT NULL,
    mac_address VARCHAR(17) NOT NULL,
    os_name VARCHAR(128) NOT NULL,
    os_build VARCHAR(32),
    cpu_model VARCHAR(128),
    total_ram_mb INTEGER NOT NULL,
    agent_version VARCHAR(32) NOT NULL,
    status VARCHAR(16) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'BLOCKED', 'REVOKED')),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_devices_tenant_status ON devices(tenant_id, status);

-- 4. Anlık Cihaz Telemetrisi (Telemetry Time-Series)
CREATE TABLE IF NOT EXISTS device_telemetry (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(64) REFERENCES devices(id) ON DELETE CASCADE,
    cpu_percent REAL NOT NULL,
    used_ram_mb INTEGER NOT NULL,
    free_disk_gb REAL NOT NULL,
    active_user VARCHAR(64),
    is_locked BOOLEAN DEFAULT FALSE,
    uptime_sec BIGINT NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_telemetry_device_time ON device_telemetry(device_id, recorded_at DESC);

-- 5. Tahrif Edilemez Denetim Günlüğü (Audit Logs)
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) REFERENCES tenants(id),
    operator_id VARCHAR(64) REFERENCES operators(id),
    target_device_id VARCHAR(64) REFERENCES devices(id),
    action_type VARCHAR(64) NOT NULL,
    parameters_json JSONB,
    execution_result VARCHAR(16) NOT NULL CHECK (execution_result IN ('SUCCESS', 'DENIED', 'FAILED')),
    error_message TEXT,
    operator_ip VARCHAR(45) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX idx_audit_device ON audit_logs(target_device_id);
```

---

## 4. AŞAMA 2: NOC İZLEME MOTORU VE İKİ KADEMELİ AKIŞ

### 4.1 İki Kademeli Akış Mimarisi (Grid Snapshot vs Canlı Akış)
* **Sorun:** 100 cihazın her birinden saniyede 60 kare video çekilirse:
  $$100 \times 60 \text{ FPS} \times 150 \text{ KB/kare} = 900 \text{ MB/saniye} \approx 7.2 \text{ Gbps Bandwidth (Ağ Çökmesi)}$$
* **Çözüm (NOC Grid İzolasyonu):**
  - **Grid Modu:** Ajan arka planda 10 saniyede bir 320x180 piksel JPEG snapshot alır.
    $$100 \times 0.1 \text{ FPS} \times 12 \text{ KB/snapshot} = 120 \text{ KB/saniye} \approx 0.96 \text{ Mbps (Sıfır Ağ Yükü)}$$
  - **Canlı Konsol:** Operatör bir cihaza tıkladığında sunucu ajana `STREAM_START(fps=60, quality=85)` bayrağı yollar; akıcı video yalnızca bu bağlantıya aktarılır.

### 4.2 NOC Sağlık Kontrolü ve Eşik Değer Algoritmaları
Ajan her 15 saniyede bir gönderdiği nabız (heartbeat) verisinde yerel eşikleri denetler:
* $\text{CPU} > 90\%$ (3 periyot üst üste) $\rightarrow$ `ALERT_HIGH_CPU`
* $\text{Kullanılabilir Disk} < 10 \text{ GB}$ $\rightarrow$ `ALERT_LOW_DISK`
* $\text{RAM Kullanımı} > 95\%$ $\rightarrow$ `ALERT_HIGH_MEMORY`
* Son nabızdan bu yana $45 \text{ saniye}$ geçtiyse sunucu durumu anında `OFFLINE` rozetine çeker.

---

## 5. AŞAMA 3: WIN32 SİSTEM VE KULLANICI OTURUMU MİMARİSİ

Windows Vista'dan itibaren Session 0 yalıtımı (Service Hardening) gereği, Windows servisleri kullanıcı masaüstüyle doğrudan etkileşime giremez.

```
+----------------------------------------------------------------------------------------------------+
|                                    WINDOWS OTURUM YALITIM DİYAGRAMI                                 |
+--------------------------------------------------+-------------------------------------------------+
|               SESSION 0 (İZOLE SERVİS)           |          SESSION 1, 2... (KULLANICI MASAÜSTÜ)   |
|                                                  |                                                 |
|  [RemoteMMAgent.exe --service]                   |  [RemoteMMAgent.exe --session-worker]           |
|  • LocalSystem (Tam Yönetici Yetkisi)            |  • Aktif Kullanıcı Oturumunda Çalışır           |
|  • Ekran/Pencere Göremez (Kör Katman)            |  • Masaüstü Context'ine Sahiptir                |
|  • Oturum Değişimlerini Algılar (WTS_SESSION)   |  • GDI32 / Desktop API'lerine Doğrudan Erişir   |
|         │                                        |         │                                       |
|         └───> Named Pipe IPC / Local Socket <────┴─────────┘                                       |
|               (\\.\pipe\RemoteMM_IPC_{HWID})                                                       |
+----------------------------------------------------------------------------------------------------+
```

### 5.1 Oturum Algılama ve Süreç Enjeksiyonu (Win32 API Çağrıları)
Windows Servisi kullanıcının masaüstüne işçi süreci başlatmak için aşağıdaki sırayı izler:

1. **Aktif Oturum Kimliğini Alma:**
   ```c
   DWORD sessionId = WTSGetActiveConsoleSessionId();
   ```
2. **Kullanıcı Tokenını Alma:**
   ```c
   HANDLE hUserToken = NULL;
   WTSQueryUserToken(sessionId, &hUserToken);
   ```
3. **SYSTEM Token Çoğaltma ve SessionId Atama (UAC / Yönetici Yetkisi İçin):**
   ```c
   HANDLE hPrimaryToken = NULL;
   DuplicateTokenEx(hUserToken, 0xF01FF, NULL, SecurityImpersonation, TokenPrimary, &hPrimaryToken);
   SetTokenInformation(hPrimaryToken, TokenSessionId, &sessionId, sizeof(DWORD));
   ```
4. **Ortam Bloğu ve Masaüstü Hedefi Oluşturma:**
   ```c
   LPVOID pEnv = NULL;
   CreateEnvironmentBlock(&pEnv, hPrimaryToken, FALSE);
   
   STARTUPINFO si = { sizeof(si) };
   si.lpDesktop = L"WinSta0\\Default"; // Normal masaüstü
   // Kilit ekranında: si.lpDesktop = L"WinSta0\\Winlogon";
   
   PROCESS_INFORMATION pi = { 0 };
   CreateProcessAsUserW(
       hPrimaryToken, NULL, L"\"C:\\RemoteMM\\RemoteMM_Agent.exe\" --session-worker",
       NULL, NULL, FALSE, CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
       pEnv, NULL, &si, &pi
   );
   ```

### 5.2 GDI32 Yüksek Performanslı Ekran Yakalama Matrisi
* **DC Sıfırlama ve Çift Tamponlama:**
  Her yakalamada `CreateCompatibleDC` ve `CreateCompatibleBitmap` sıfırdan çağrılmaz; çözünürlük değişmediği sürece bellek DC'si ve bitmap önbellekte tutulur:
  ```python
  # Bellek Hizalama (Memory Alignment Stride)
  stride = (width * 3 + 3) & ~3
  # BitBlt ile 0,0 koordinatından tam ekran kopyalama
  gdi32.BitBlt(hdc_mem, 0, 0, width, height, hdc_screen, 0, 0, 0x00CC0020) # SRCCOPY
  ```
* **Kilit Ekranı ve Masaüstü Geçişi:**
  Kullanıcı `Win+L` yaptığında giriş masaüstü değişir. İşçi thread periyodik olarak input desktop kontrolü yapar:
  ```c
  HDESK hInput = OpenInputDesktop(0, FALSE, 0x02000000 | 0x0001 | 0x0040);
  SetThreadDesktop(hInput);
  ```

### 5.3 Koordinat Normalizasyonu ve DPI Uyumluluğu
Farklı çözünürlük ve DPI ölçeklemelerinde (%125, %150) fare imlecinin sapmaması için:
```c
SetProcessDPIAware(); // Süreç başında çağrılır
```
Operatörden gelen $[0.0, 1.0]$ normalize koordinatları mutlak piksele çevrilir:
$$\text{dx} = \text{round}(x_{\text{percent}} \times \text{ScreenWidth})$$
$$\text{dy} = \text{round}(y_{\text{percent}} \times \text{ScreenHeight})$$
$$dx_{\text{m}} = \text{round}\left(dx \times \frac{65535}{\text{ScreenWidth}}\right), \quad dy_{\text{m}} = \text{round}\left(dy \times \frac{65535}{\text{ScreenHeight}}\right)$$
`SendInput` API'sine `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE` bayraklarıyla iletilir.

---

## 6. AŞAMA 4: SİSTEM OPERASYONLARI VE GÜVENLİK SINIRLARI

### 6.1 Parametrik İzinli Komut Şeması (Command Whitelist)
Rasgele `cmd.exe /c [string]` çalıştırmak kesinlikle engellenmiştir. Ajan yalnızca aşağıdaki doğrulanmış eylemleri kabul eder:

| Komut Kodu | Parametreler | İzin Kontrolü | Win32 / Kernel API |
|---|---|---|---|
| `ACT_POWER_REBOOT` | `{ force: bool, timeout: int }` | ADMIN, NOC_OPERATOR | `InitiateSystemShutdownExW` |
| `ACT_POWER_SHUTDOWN`| `{ force: bool, timeout: int }` | ADMIN | `InitiateSystemShutdownExW` |
| `ACT_POWER_LOCK` | Boş | TÜM ROLLER | `LockWorkStation` |
| `ACT_PROCESS_KILL` | `{ pid: int }` | ADMIN, NOC_OPERATOR | `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess` |
| `ACT_SERVICE_START` | `{ serviceName: string }` | ADMIN | `OpenSCManagerW` + `StartServiceW` |
| `ACT_SERVICE_STOP` | `{ serviceName: string }` | ADMIN | `ControlService(SERVICE_CONTROL_STOP)` |

* **Korumalı Süreç Listesi (Kernel Kill Protection):**  
  `pid` şu süreçlere aitse eylem ajanda doğrudan `ACCESS_DENIED` döner:  
  `System`, `smss.exe`, `csrss.exe`, `wininit.exe`, `services.exe`, `lsass.exe`, `svchost.exe`, `RemoteMM_Agent.exe`.

### 6.2 Güvenli Dosya Yöneticisi ve Yol Doğrulaması (Path Traversal Koruması)
Her dosya işlemi öncesi hedef yol mutlaklaştırılır (`canonicalize`) ve denetlenir:
```python
def is_safe_path(target_path):
    abs_path = os.path.abspath(target_path)
    # Kök dizin ihlalleri engellenir
    blocked_roots = [
        os.environ.get('SystemRoot', 'C:\\Windows') + '\\System32\\config',
        os.environ.get('SystemRoot', 'C:\\Windows') + '\\System32\\drivers\\etc'
    ]
    for b in blocked_roots:
        if abs_path.lower().startswith(b.lower()):
            return False
    return True
```
* **SHA-256 Doğrulamalı Parçalı Transfer:**  
  Dosyalar 256 KB boyutunda parçalanır (`chunkIndex`, `totalChunks`). Dosya tamamlandığında hedef makine SHA-256 özetini hesaplar; operatörün yolladığı özetle uyuşmazsa dosya derhal imha edilir.

---

## 7. AŞAMA 5: KURUMSAL DAĞITIM VE KENDİNİ ONARMA MOTORU

### 7.1 Windows Service Control Manager (SCM) Kendi Kendini Onarma
Ajan servisi kurulurken çökmelere karşı dirençli yapılandırılır:
```cmd
sc.exe create RemoteMMAgent binPath= "C:\RemoteMM\RemoteMM_Agent.exe --service" start= auto obj= "NT AUTHORITY\System" DisplayName= "RemoteMM Enterprise Agent"
sc.exe failure RemoteMMAgent reset= 86400 actions= restart/5000/restart/10000/restart/30000
sc.exe failureflag RemoteMMAgent 1
```

### 7.2 Güvenli Güncelleme ve Geri Alma (Auto-Rollback State Machine)
```
      [Yeni Sürüm İndirildi (RemoteMM_Agent_new.exe)]
                            │
              ┌─────────────▼─────────────┐
              │ SHA-256 Hash Doğrulandı mı│
              └─────────────┬─────────────┘
                     EVET   │   HAYIR ───> [İndirilen Dosyayı Sil & Hata Raporla]
                            ▼
              [Mevcut Binary'yi Yedekle (RemoteMM_Agent.bak)]
                            │
              [Dosyayı Değiştir & Servisi Yeniden Başlat]
                            │
              ┌─────────────▼─────────────┐
              │ 30 sn içinde Sunucuya     │
              │ Sağlık Sinyali Gitti mi?  │
              └─────────────┬─────────────┘
                     EVET   │   HAYIR
                            │     │
                            │     ▼ (Çökme veya Yanıtsızlık)
                            │   [Yedeği Geri Yükle (RemoteMM_Agent.bak)]
                            │   [Servisi Eski Sürümle Başlat]
                            │   [Sunucuya ROLLBACK_EVENT Gönder]
                            ▼
                   [GÜNCELLEME BAŞARILI]
```

---

## 8. REGÜLASYON, UYUMLULUK VE KVKK ŞARTNAMESİ

### 8.1 KVKK 12. Madde ve ISO 27001 Madde 9.4 Uyumluluğu
1. **Şeffaf Oturum:** Destek oturumu süresince kullanıcının ekranında kapatılamaz, en üstte duran (`HWND_TOPMOST`) bilgi rozeti bulunur.
2. **Kullanıcı Rızası (Prompt for Consent):** Kurumsal politika aktif edildiğinde, teknisyen bağlantı başlattığında kullanıcının ekranında 30 saniyelik geri sayımla:
   > *"Bilgi İşlem Departmanından [Operatör Adı] bilgisayarınıza uzaktan erişim talep ediyor. İzin veriyor musunuz? [Kabul Et] / [Reddet]"*
3. **Gizli Ekran & Fiziksel Kilit Kısıtlaması:** Karşı monitörü karartma (`BLACKOUT_SCREEN`) ve klavye kilitleme (`LOCK_INPUT`) varsayılan olarak kapalıdır; yalnızca `SUPER_ADMIN` rolünün yazılı onayı ile açılabilir.

---

## 9. TEST, KALİTE VE KABUL KRİTERLERİ

Her geliştirme turunun kabul edilmesi için aşağıdaki otomatik testlerin tamamından `%100` başarıyla geçilmelidir:

| Test Kategorisi | Test Dosyası | Kapsam |
|---|---|---|
| **Protokol & Şema** | `tests/test_agent_protocol.py` | El sıkışma, kare paketi, sınır kontrolleri, dosya limiti, komut izin listesi. |
| **Gateway & Durum** | `tests/test_gateway_state.mjs` | Bağlantı durum makinesi, üstel bekleme hesabı, parola filtreleme. |
| **Entegrasyon** | `tests/test_e2e_connection.py` | Sahte TCP istemcisiyle canlı bağlantı, ekran karesi alma ve yanıt süreleri. |
| **Güvenlik** | `tests/test_security_bounds.py` | Path traversal, geçersiz token, tampon taşması ve bellek sızıntısı testleri. |

Tüm sonuçlar tarih, saat ve işletim sistemi bilgisiyle `docs/TEST_REPORT.md` içine kaydedilir. Dokümantasyonu güncellenmeyen hiçbir kod üretime kabul edilmez.
