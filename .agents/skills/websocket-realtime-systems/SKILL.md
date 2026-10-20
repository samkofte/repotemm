---
name: websocket-realtime-systems
description: RemoteMM Enterprise WebSocket sunucusu, çift yönlü TCP köprüleme, gerçek zamanlı video akışı ve geri basınç (backpressure) yönergeleri.
---

# WebSocket Real-Time Systems — RemoteMM Enterprise

Bu kılavuz, Node.js Gateway sunucusu (`server/index.js`), WebSocket istemcisi (`src/App.jsx`) ve Python ajanı arasındaki gerçek zamanlı çift yönlü veri köprüsünün mimari ilkelerini ve hata ayıklama kurallarını açıklar.

---

## 1. Mimari Akış ve Çift Yönlü Köprü

```
[React UI / Electron] 
       │ (WebSocket JSON / RMM2 İkili Kareler)
       ▼
[Node.js Gateway Hub (server/index.js - Port 3001)]
       │ (Raw TCP Soket - Port 6129)
       ▼
[Python Remote Agent (agent/py_agent.py)]
```

- **Bağlantı URL Biçimi:**  
  `ws://<GATEWAY_HOST>:3001?targetHost=<AGENT_IP>&port=6129&token=<DEVICE_TOKEN>&role=<ROLE>`
- **Proxy Mantığı:** Gateway, tarayıcıdan gelen WebSocket mesajlarını doğrudan ham TCP soketine yazar; ajandan gelen TCP akışını ise WebSocket istemcisine iletir.

---

## 2. Geri Basınç (Backpressure) ve Kare Düşürme (Frame Dropping)

Canlı uzak masaüstü akışında ağ tıkanıklıklarını ve istemci gecikmelerini önlemek için:

1. **Tampon Taşması Koruması:**
   - Gateway, WebSocket istemcisinin `bufferedAmount` değerini izler.
   - Eğer istemci önceki kareyi henüz tüketemediyse (`bufferedAmount > 256 * 1024`), ara video kareleri düşürülür (drop frame); yalnızca en son anahtar kare iletilir.
2. **Akış Modu Anahtarlama (Two-Tier Streaming):**
   - **PREVIEW Modu (NOC Grid):** 3-10 saniyede bir düşük çözünürlüklü (320x180) küçük resim (`capture_thumbnail`).
   - **INTERACTIVE Modu (Canlı Konsol):** Operatör cihaza bağlandığında `SET_STREAM_MODE` komutuyla 30-60 FPS yüksek kaliteli akış aktif edilir.

---

## 3. Bağlantı Durum Makinesi ve Üstel Geri Çekilme (Exponential Backoff)

Ağ kopmalarında kontrolsüz yeniden bağlanma fırtınasını (thundering herd) engellemek için `src/App.jsx` ve `tests/test_gateway_state.mjs` içinde doğrulanmış durum makinesi uygulanır:

```
[DISCONNECTED] ──> [CONNECTING] ──> [CONNECTED]
      ▲                  │                 │
      │                  ▼                 ▼
   [ERROR] <────── [RECONNECTING] <────────┘ (Bağlantı koptuğunda)
```

- **Gecikme Formülü:**  
  $$\text{Delay}(n) = \min(1000 \times 1.5^{n-1}, 15000) \text{ ms}$$
  (1. deneme: 1.0s, 2. deneme: 1.5s, 3. deneme: 2.25s ... maksimum 15s tavan).

---

## 4. Hata Ayıklama ve İnceleme Adımları

1. **Gateway WebSocket Sunucusunu Başlatma:**
   ```powershell
   node server/index.js
   ```
2. **Aktif Soket Bağlantılarını İzleme:**
   - `[WS Proxy]` etiketli konsol logları hedef makineye TCP el sıkışma aşamasını (`CONNECTED to target`), iletilen bayt miktarını ve bağlantı kopma nedenlerini (`TCP Error`, `WS Closed`) raporlar.
3. **Parola ve Hassas Veri Maskeleme:**
   - Loglarda şifre, `deviceToken` veya kimlik bilgileri açık metin yazılamaz; `server/index.js` içindeki `maskSensitiveParams()` fonksiyonu ile `***REDACTED***` olarak maskelenmelidir.

---

## 5. Tamamlanma Kriterleri

- `node --test tests/test_gateway_state.mjs` komutunda WebSocket ve bağlantı durum testleri eksiksiz geçmelidir.
- Ajan TCP soketi kapandığında WebSocket istemcisine anında `SESSION_CLOSED` bildirimi gitmeli, askıda (zombie) soket kalmamalıdır.
- RMM2 ikili kareleri iletilirken JSON serileştirme hatası fırlatılmamalıdır.
