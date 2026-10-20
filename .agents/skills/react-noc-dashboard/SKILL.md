---
name: react-noc-dashboard
description: RemoteMM Enterprise React 19 ve Tailwind CSS NOC Kontrol Paneli, Canlı Konsol HUD, Filo Izgarası ve Arayüz Optimizasyon yönergeleri.
---

# React NOC Dashboard — RemoteMM Enterprise

Bu kılavuz, RemoteMM platformunun operatör ve yönetici arayüzünü oluşturan React 19 ve Tailwind CSS bileşenlerinin (`src/App.jsx`, `src/main.jsx`), canlı ekran akışının ve veri görselleştirme kurallarını belirler.

---

## 1. Arayüz Sekmeleri ve Modüler Yapı

`src/App.jsx` tek sayfada 7 temel kurumsal modülü barındırır:

1. **Tab 1: Canlı Konsol (`activeTab === 'console'`):**
   - Düşük gecikmeli ekran akışı, fare ve klavye etkileşimi.
   - Yüzen HUD araç çubuğu: Ölçekleme modu (Fit / 100%), Dinamik Yayın Kalitesi (%55 - %95), Çoklu Monitör Seçici, Özel Tuşlar (CAD, Win+L, Görev Yöneticisi), Uzak Pano Menüsü, Giriş ve Ekran Kilidi.
   - KVKK Rıza Modalı (`requireConsent`) ve Entegre Yan Panel (Sohbet / Süreçler).
2. **Tab 2: Sunucu Filosu & NOC Grid (`activeTab === 'fleet'`):**
   - 16:9 canlı küçük resim önizlemeleri (`capture_thumbnail`).
   - Gerçek zamanlı sistem telemetrisi (CPU %, RAM GB, Boş Disk, Uptime, Kilit durumu).
   - NOC Sağlık Eşik Rozetleri (🔥 CPU > 90%, 💾 Disk < 10GB, ⚡ RAM > 95%, ⚠️ Yanıtsız > 45s).
   - "🚨 Alarmlı Sunucular" tek tuş filtreleme anahtarı.
3. **Tab 3: Süreçler ve Windows Servisleri (`activeTab === 'processes'`):**
   - Aktif süreçler tablosu ve görev sonlandırma.
   - Saf Win32 tabanlı Windows servisleri listesi, arama ve Başlat/Durdur/Yeniden Başlat aksiyonları.
4. **Tab 4: Uzak Dosya Gezgini (`activeTab === 'files'`):**
   - Uzak dizin ağacı, 25 MB sınırlı parçalı dosya indirme/yükleme, SHA-256 bütünlük doğrulaması.
5. **Tab 5: Operasyon Sohbeti (`activeTab === 'chat'`):**
   - Uzak kullanıcı Tkinter destek penceresiyle çift yönlü gerçek zamanlı mesajlaşma.
6. **Tab 6: Ajan Dağıtım Merkezi (`activeTab === 'deployment'`):**
   - GPO PowerShell, Kurumsal Batch, WiX MSI ve Microsoft Intune dağıtım komutları.
7. **Tab 7: Denetim İzi & Mevzuat (`activeTab === 'audit'`):**
   - ISO 27001 işlem logları, filtreleme, CSV ve JSON formatında mevzuat dışa aktarımı.

---

## 2. Canlı Konsol Fare Olayları ve Koordinat Normalizasyonu

Operatörün fare hareketleri ve tıklamaları ekran çözünürlüğünden bağımsız normalize edilir:

```javascript
const handleMouseMove = (e) => {
  if (!canvasRef.current || !isConnected || isViewOnly) return;
  const rect = canvasRef.current.getBoundingClientRect();
  const rawX = (e.clientX - rect.left) / rect.width;
  const rawY = (e.clientY - rect.top) / rect.height;
  const x = Math.max(0.0, Math.min(1.0, rawX));
  const y = Math.max(0.0, Math.min(1.0, rawY));
  
  sendSocketMessage({
    type: 'MOUSE_INPUT',
    x,
    y,
    action: 'move'
  });
};
```

---

## 3. Performans ve DOM Optimizasyon Kuralları

1. **Gereksiz Render'ları Engelleme:**
   - 30-60 FPS ekran akışında her kare için tüm DOM'u yeniden render etmek yerine yalnızca görüntü nesnesi güncellenmelidir (`setFrameSrc`).
2. **Kayan Bildirim (Toast) Yaşam Döngüsü:**
   - Pano kopyalama/yapıştırma bildirimleri (`clipboardToastText`) `setTimeout` ile 3 saniye sonra otomatik temizlenir.
3. **Klavye Odak Yakalama (Key Capture):**
   - Canlı konsoldayken `window.addEventListener('keydown')` varsayılan tarayıcı kısayollarını (`F5`, `Ctrl+W`, `Alt+Tab`) engelleyerek hedef makineye `KEY_INPUT` olarak iletir.

---

## 4. Tamamlanma ve Derleme Kriterleri

- `npm run build` komutu 0 hata ve uyarı ile başarıyla tamamlanmalıdır (`dist/index.html`, `dist/assets/*`).
- `npm run lint` veya oxlint kontrollerinde kırık import veya JSX syntax hatası olmamalıdır.
