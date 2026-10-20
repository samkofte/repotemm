---
name: windows-agent-engineering
description: RemoteMM Enterprise Windows Ajanı mühendisliği, Win32 API, GDI ekran yakalama, UAC/Winlogon geçişi ve Session 0 izolasyonu yönergeleri.
---

# Windows Agent Engineering — RemoteMM Enterprise

Bu kılavuz, Windows platformunda arka planda SYSTEM veya interaktif kullanıcı oturumunda çalışan RemoteMM Ajanı'nın (`agent/py_agent.py`) düşük seviyeli Win32 sistem çağrılarını, GDI çift tamponlama motorunu ve güvenli masaüstü geçiş kurallarını açıklar.

---

## 1. Oturum Yalıtımı (Session 0 Isolation) ve Süreç Başlatma

Windows servisleri (Session 0) doğrudan kullanıcı arayüzüne çizim yapamaz. Ajan aşağıdaki Win32 zincirini izler:

1. **Aktif Konsol Oturumunu Bulma:**
   ```c
   DWORD sessionId = WTSGetActiveConsoleSessionId();
   ```
2. **Kullanıcı Token'ını Alma ve Çoğaltma:**
   `WTSQueryUserToken(sessionId, &hUserToken)` çağrılır; ardından `DuplicateTokenEx` ile primary token oluşturulup `SetTokenInformation(TokenSessionId)` ile aktif oturuma atanır.
3. **Masaüstü Bağlamında Süreç Çalıştırma:**
   `CreateProcessAsUserW` API'si `STARTUPINFO.lpDesktop = L"WinSta0\\Default"` hedefiyle interaktif oturumda çalıştırılır.

---

## 2. GDI32 Yüksek Performanslı Ekran Yakalama ve Çift Tamponlama

- **Hafıza Hizalama (Memory Alignment Stride):**
  Piksel satır hizalamasını korumak için satır uzunluğu 4 bayt sınırına yuvarlanır:
  $$\text{stride} = (\text{width} \times 3 + 3) \ \& \sim 3$$
- **Hafıza DC ve Bitmap Önbelleği:**
  Her karede sıfırdan DC oluşturulmaz. Ekran çözünürlüğü değişmediği sürece `hdc_mem` ve `hbm` bellekte tutulur, `BitBlt` ile doğrudan `SRCCOPY (0x00CC0020)` kopyalama yapılır.
- **UAC ve Kilit Ekranı (Winlogon / Secure Desktop) Geçişi:**
  Kullanıcı `Win+L` bastığında veya UAC uyarısı açıldığında `BitBlt` başarısız olur (`not ok`). Ajan derhal giriş masaüstünü sorgular ve thread masaüstünü günceller:
  ```python
  h_desk = user32.OpenInputDesktop(0, False, 0x02000000 | 0x0001 | 0x0040)
  if h_desk:
      user32.SetThreadDesktop(h_desk)
      user32.CloseDesktop(h_desk)
  ```

---

## 3. Koordinat Normalizasyonu ve DPI Uyumluluğu

Farklı ekran çözünürlükleri ve ölçeklemelerinde (%100, %125, %150) fare imlecinin kaymasını önlemek için süreç başında `user32.SetProcessDPIAware()` çağrılır.

Operatörden gelen $[0.0, 1.0]$ normalize koordinatları mutlak piksel uzayına dönüştürülür:
$$dx = \text{round}(x_{\text{norm}} \times \text{ScreenWidth}), \quad dy = \text{round}(y_{\text{norm}} \times \text{ScreenHeight})$$
$$dx_{\text{m}} = \text{round}\left(dx \times \frac{65535}{\text{ScreenWidth}}\right), \quad dy_{\text{m}} = \text{round}\left(dy \times \frac{65535}{\text{ScreenHeight}}\right)$$
`SendInput` API'sine `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE | MOUSEEVENTF_VIRTUALDESK` bayraklarıyla gönderilir.

---

## 4. Çift Yönlü Uzak Pano (Remote Clipboard) Senkronizasyonu

- Pano işlemleri `CF_UNICODETEXT (13)` formatında yürütülür.
- Metin yazılırken bellek `kernel32.GlobalAlloc(GMEM_MOVEABLE, size)` ile ayrılır, `kernel32.GlobalLock` ile kilitlenip `ctypes.memmove` ile kopyalanır.
- Maksimum pano aktarım boyutu bellek güvenliği için 64 KB (`65536` karakter) ile sınırlandırılmıştır.

---

## 5. SCM Kendi Kendini Onarma (Self-Healing) Yapılandırması

Kurulum sırasında servisin çökme durumlarında otomatik yeniden başlaması sağlanır:
```cmd
sc.exe failure RemoteMMAgent reset= 86400 actions= restart/5000/restart/10000/restart/30000
sc.exe failureflag RemoteMMAgent 1
```

---

## 6. Tamamlanma Kriterleri

- `tests/test_agent_protocol.py` içindeki tüm donanım parmak izi, çoklu monitör, GDI ve pano testleri başarıyla tamamlanmalıdır.
- Task Manager'da ajanın GDI Tutamaç (GDI Handles) sayısı sabit kalmalı, sızıntı yaşanmamalıdır (< 50 handles).
- Kilit ekranında (`Win+L`) ajan çökmeksizin kilit ekranını operatöre aktarabilmelidir.
