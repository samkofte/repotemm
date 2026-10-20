---
name: integration-performance-diagnostics
description: RemoteMM Enterprise uçtan uca (E2E) entegrasyon testleri, ağ gecikmesi ölçümü, performans teşhisi ve log ilişkilendirme yönergeleri.
---

# Integration & Performance Diagnostics — RemoteMM Enterprise

Bu kılavuz, RemoteMM platformunun uçtan uca (E2E) entegrasyon testlerini, performans kıyaslamalarını, ağ gecikmesi ölçümünü ve bileşenler arası log ilişkilendirme yöntemlerini belirler.

---

## 1. Test Mimarisi ve Kapsamı

RemoteMM, farklı katmanlarda çalışan otomatik test süitlerine sahiptir:

```
tests/
├── test_agent_protocol.py    # 22 Test: Handshake şeması, RMM2 ikili framing, GDI, Pano, Servis kontrolü
├── test_security_bounds.py   # 5 Test: Path traversal, tampon taşması, çekirdek süreç koruma, token tahrifatı
├── test_e2e_connection.py    # 4 Test: Canlı TCP el sıkışma, Ping/Pong gecikmesi, akış modları, sohbet
└── test_gateway_state.mjs    # 10 Test: Durum makinesi, üstel bekleme, SQLite kayıt, RBAC, WoL alt ağ hesabı
```

Toplam: **41 Otomatik Test (%100 Başarı Oranı)**.

---

## 2. Test Çalıştırma ve Doğrulama Komutları

### A. Tüm Python Test Süitlerini Çalıştırma
```powershell
python -m unittest discover -s tests -p "test_*.py"
```
*Tüm testlerin süresi 0.5 saniyenin altında olmalı ve 31 testin tamamı `OK` dönmelidir.*

### B. Node.js Gateway ve Codec Testlerini Çalıştırma
```powershell
node --test tests/test_gateway_state.mjs
```
*10 testin tamamı yeşil `pass` ile sonuçlanmalıdır.*

### C. Arayüz Derleme ve Paket Bütünlüğü Testi
```powershell
npm run build
```
*Vite derleyicisi 0 hata ile `dist/index.html` ve varlıkları üretmelidir.*

---

## 3. Ağ Gecikmesi ve Performans Teşhisi (RTT Diagnostics)

1. **Ping/Pong Gecikme Ölçümü:**
   - İstemci `PING` paketiyle birlikte `timestamp: Date.now()` iletir.
   - Ajan aynı zaman damgasıyla `PONG` döner; aradaki fark operatör ekranında `latency (ms)` olarak yansıtılır:
     $$\text{Latency} = \text{Date.now()} - \text{ping.timestamp}$$
   - Kurumsal ağlarda hedef RTT $< 30 \text{ ms}$, WAN ortamında $< 80 \text{ ms}$ olmalıdır.
2. **GDI Bellek Sızıntısı Teşhisi:**
   - Win32 `GetGuiResources(GetCurrentProcess(), 0)` çağrısı ile ajanın açık GDI nesneleri periyodik denetlenir; 100 handle üzerine çıkması sızıntı işaretidir.

---

## 4. Çok Bileşenli Log İlişkilendirme (Log Correlation)

Bir oturumda arıza meydana geldiğinde, hata üç farklı kaynaktan zaman damgası ve `HWID` üzerinden izlenir:

1. **Gateway Logu:** `[WS Proxy]` ve `[AUDIT]` etiketleri (bağlantı denemesi, token doğrulama, RBAC kararı).
2. **Ajan Debug Logu (`agent_debug.log`):** Oturum geçişleri, WTS bildirimleri, GDI yakalama hataları.
3. **Masaüstü / Tarayıcı Konsolu:** WebSocket `onerror`, `onclose` kodları (1000 normal, 1006 anormal kopma).

---

## 5. Tamamlanma ve Raporlama Kriterleri

- Her yeni özellik veya hata düzeltmesinden sonra `docs/TEST_REPORT.md` dosyasındaki test adetleri, süreler ve başarı oranları güncellenmelidir.
- Test raporu güncellenmemiş hiçbir değişiklik üretime hazır kabul edilmez.
