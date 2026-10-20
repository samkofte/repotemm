---
name: python-backend-architecture
description: RemoteMM Enterprise Python arka plan, çekirdek soket sunucusu, Win32 API bağlayıcıları ve sistem yönetim mimarisi yönergeleri.
---

# Python Backend Architecture — RemoteMM Enterprise

Bu kılavuz, RemoteMM platformunun Windows sistemlerinde çalışan Python çekirdek bileşenlerinin (`agent/py_agent.py`, `agent/rmm2_protocol.py`, `agent/service_manager.py`, `agent/telemetry.py`, `agent/updater.py`, `agent/identity.py`, `agent/display.py`) mimari tasarımını, protokol sözleşmelerini ve geliştirme kurallarını belirler.

---

## 1. Mimari Düzen ve Bileşen Sorumlulukları

```
agent/
├── py_agent.py          # TCP 6129 soket sunucusu, oturum watchdog'u, GDI yakalama ve SendInput
├── rmm2_protocol.py     # 12 baytlık ikili ağ çerçeveleme (RMM2 framing) ve akış ayrıştırıcı
├── service_manager.py   # advapi32.dll ile saf Win32 SCM servis kontrolü (Start, Stop, Enum)
├── telemetry.py         # CPU, RAM, Disk, Uptime ve NOC eşik alarm motoru (Section 4.2)
├── display.py           # EnumDisplayMonitors ile çoklu monitör tespiti ve koordinat uzayı haritalama
├── identity.py          # BIOS, CPU, MachineGuid ve MAC'ten 64 karakter SHA-256 HWID üretimi
└── updater.py           # SHA-256 doğrulamalı .bak yedekli otomatik geri alma (Auto-Rollback) motoru
```

---

## 2. Temel Tasarım Kuralları ve Kısıtlar

1. **Dış Bağımlılık Yasağı (Pure Python + Win32 ctypes):**
   - Ajan çalışma zamanı yalnızca Python standart kütüphanesini ve `ctypes` (`kernel32`, `user32`, `gdi32`, `advapi32`, `wtsapi32`) kullanmalıdır.
   - Ekran yakalamada PIL/Pillow JPEG sıkıştırması için kullanılır; harici C derlemesi gerektiren ağır kütüphaneler eklenemez.
2. **Kabuk Enjeksiyonu Yasağı (No Raw Shells - Section 1.1 #3):**
   - `os.system("net start ...")` veya rasgele `cmd.exe /c [string]` komutları kesinlikle çalıştırılamaz.
   - Servis işlemleri `agent/service_manager.py` içindeki `advapi32.OpenServiceW` ve `advapi32.ControlService` API'leriyle parametrik yürütülür.
   - Süreç sonlandırma `kernel32.TerminateProcess` ile parametrik PID üzerinden yürütülür.
3. **Kritik Çekirdek Süreç Koruması (Kernel Kill Protection):**
   - Aşağıdaki süreç ve servislerin kapatılması/sonlandırılması ajanda engellenmelidir:
     `RemoteMMAgent`, `System`, `smss.exe`, `csrss.exe`, `wininit.exe`, `services.exe`, `lsass.exe`, `svchost.exe`, `RpcSs`, `EventLog`, `PlugPlay`.

---

## 3. Protokol ve Ağ Çerçeveleme Sözleşmesi

Ajan TCP port `6129` üzerinden iki protokol modunu hibrit olarak destekler:

### A. Geleneksel JSON/Newline Modu
- Her mesaj tek satır JSON ve `\n` ile sonlandırılır.
- Büyük paketler (dosya transferi) maksimum 25 MB (`MAX_FILE_SIZE = 25 * 1024 * 1024`) sınırına tabidir.

### B. RMM2 İkili Ağ Çerçeveleme Modu (Section 3.2)
- 12 Baytlık Sabit Başlık (Big-Endian):
  ```
  [0..3]   MAGIC: 0x524D4D32 ("RMM2")
  [4]      PKT_TYPE: uint8 (0x01: Handshake, 0x10: Screen Frame, 0x11: Mouse, 0x30: Action...)
  [5]      FLAGS: uint8 (0x00: Raw, 0x01: Compressed, 0x02: Encrypted, 0x04: JSON)
  [6..7]   RESERVED: uint16 (0x0000)
  [8..11]  PAYLOAD_LENGTH: uint32 (Maksimum 64 MB)
  ```
- Video kareleri (`0x10`) Base64 dönüşümü yapılmadan doğrudan ham JPEG ikili verisi olarak aktarılır.

---

## 4. Hata Ayıklama ve Operasyonel Adımlar

1. **Konsol Modunda Hata Ayıklama:**
   ```powershell
   # Doğrudan interaktif sunucu modunda çalıştırma
   python agent/py_agent.py --server
   ```
2. **Durum ve Kimlik Kontrolü:**
   ```powershell
   python agent/py_agent.py --status
   ```
3. **Log Dosyaları:**
   - Servis çökme ve istisna kayıtları: `agent_crash.log`
   - Oturum geçişleri ve WTS olayları: `agent_debug.log`
4. **PyInstaller Derleme Doğrulaması:**
   ```powershell
   pyinstaller --noconfirm agent/RemoteMM_Agent.spec
   ```

---

## 5. Tamamlanma Kriterleri

- `python -m unittest discover -s tests -p "test_*.py"` komutu sıfır hata ile geçmelidir (en az 31 test).
- Bellek sızıntısı olmaksızın GDI DC ve Bitmap nesneleri (`DeleteDC`, `DeleteObject`) her döngüde serbest bırakılmalıdır.
- Yüksek DPI ekranlarda `%125` veya `%150` ölçekleme altında koordinat sapması sıfır olmalıdır (`user32.SetProcessDPIAware()`).
