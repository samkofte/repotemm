---
name: remote-management-security
description: RemoteMM Enterprise Sıfır-Güven (Zero-Trust), KVKK kullanıcı rızası, ISO 27001 denetim kütüğü, RBAC yetki matrisi ve güvenlik sınırları yönergeleri.
---

# Remote Management Security — RemoteMM Enterprise

Bu kılavuz, RemoteMM platformunun KVKK (Türkiye), GDPR (AB) ve ISO/IEC 27001:2022 standartlarına uyumlu Sıfır-Güven (Zero-Trust) güvenlik mimarisini, rol tabanlı erişim denetimini (RBAC) ve denetim izi kurallarını belirler.

---

## 1. Dört Seviyeli Rol Tabanlı Erişim Denetimi (RBAC Matrix)

Yetkilendirme yalnızca React arayüzüne bırakılamaz; Gateway sunucusunda (`server/index.js`) her WebSocket ve REST mesajında kesin olarak doğrulanır:

| Rol | İzleme (Ekran) | Kontrol (Fare/Klavye) | Dosya Yönetimi | Güç & Servisler | Pano Değişimi |
|---|---|---|---|---|---|
| **SUPER_ADMIN** | ✅ İzinli | ✅ İzinli | ✅ Tam Yetki | ✅ Tam Yetki | ✅ İzinli |
| **NOC_OPERATOR**| ✅ İzinli | ✅ İzinli | ✅ İzinli | ⚠️ Yalnızca Reboot/Lock | ✅ İzinli |
| **HELPDESK**    | ✅ İzinli | ✅ İzinli | ⚠️ İndirme/Yükleme | ❌ Engelli | ✅ İzinli |
| **AUDITOR**     | ✅ Salt-Okunur | ❌ Engelli (`DENIED`) | ❌ Engelli (`DENIED`) | ❌ Engelli (`DENIED`) | ❌ Engelli (`DENIED`) |

- **AUDITOR_FORBIDDEN Kümesi:**  
  `MOUSE_INPUT`, `KEY_INPUT`, `BLACKOUT_SCREEN`, `LOCK_INPUT`, `FS_UPLOAD`, `FS_DELETE`, `FS_EXEC`, `FS_MKDIR`, `KILL_PROCESS`, `SERVICE_ACTION`, `POWER_ACTION`, `AGENT_UPGRADE`, `CLIPBOARD_SET`.  
  Denetçi bu komutlardan birini gönderdiğinde sunucu anında `PERMISSION_DENIED` döner ve olayı güvenlik günlüğüne yazar.

---

## 2. KVKK 12. Madde ve Kullanıcı Rızası (Consent Flow)

Kullanıcının haberi olmaksızın gizli izleme yapılmasını önlemek için:

1. **30 Saniye Zaman Aşımlı Onay Modalı:**  
   Teknisyen bağlandığında karşı ekranda Win32 `MessageBoxTimeoutW` ile sistem modalı açılır:
   > *"Bilgi İşlem Departmanından [Operatör] bilgisayarınıza uzaktan erişim talep ediyor. İzin veriyor musunuz? [Kabul Et] / [Reddet]"*
2. **Kullanıcı Reddi ve Zaman Aşımı:**  
   Kullanıcı "Hayır" derse veya 30 saniye içinde yanıt vermezse ajan Gateway'e `CONSENT_REJECTED` döner ve TCP soketini derhal kapatır.
3. **Ekran Karartma Kısıtı:**  
   Monitörü karartma (`BLACKOUT_SCREEN`) ve klavyeyi kilitleme (`LOCK_INPUT`) yalnızca `SUPER_ADMIN` onaylı durumlarda açılabilir.

---

## 3. Tahrif Edilemez Denetim İzi (Audit Logging & Parameter Redaction)

- **Kayıt Yeri:** `data/audit_logs.jsonl` (Append-only döner log).
- **Hassas Parametre Maskeleme (`server/audit.js`):**
  Parola (`password`, `user_password`), token (`deviceToken`, `session_token`), gizli anahtar (`secret`, `key`) içeren tüm alanlar `***REDACTED***` olarak maskelenir.
- **Mevzuat Raporlama:**  
  `/api/audit/export?format=csv` ve `/api/audit/export?format=json` uç noktaları RFC 4180 uyumlu mühürlü kütük sunar.

---

## 4. Dizin Aşımı (Path Traversal) ve Dosya Bütünlük Koruması

1. **Güvenli Dizin Doğrulaması:**
   Dosya yöneticisi işlemlerinde mutlak yol çözülür (`os.path.abspath`). `System32\config` (SAM/SYSTEM) ve `System32\drivers\etc` köklerine yönelik istekler `ACCESS_DENIED` ile reddedilir.
2. **SHA-256 Parçalı Dosya Mühürleme:**
   Dosya aktarımı tamamlandığında hedef makinede hesaplanan SHA-256 özeti operatörün gönderdiği özetle karşılaştırılır; uyuşmazlık durumunda dosya derhal silinir.

---

## 5. Tamamlanma Kriterleri

- `tests/test_security_bounds.py` içindeki tüm güvenlik ve sınır testleri (Path traversal, tampon taşması, çekirdek süreç koruma) eksiksiz geçmelidir.
- `tests/test_gateway_state.mjs` içindeki RBAC matrisi testi ve parametre maskeleme testleri `%100` başarı sağlamalıdır.
