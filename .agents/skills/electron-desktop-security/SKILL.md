---
name: electron-desktop-security
description: RemoteMM Enterprise Electron masaüstü kabuğu, ContextBridge IPC yalıtımı, süreç güvenliği ve yerel pencere yönetimi yönergeleri.
---

# Electron Desktop Security — RemoteMM Enterprise

Bu kılavuz, RemoteMM platformunun masaüstü kabuğunu oluşturan Electron süreç mimarisini (`electron/main.cjs`, `electron/preload.cjs`), IPC güvenlik sınırlarını ve yerel paketleme kurallarını belirler.

---

## 1. Temel Güvenlik Prensipleri (Electron Hardening)

1. **Node Integration ve Context Isolation:**
   - `nodeIntegration: false` kesinlikle korunmalıdır. Web içeriğinin doğrudan Node.js çalışma zamanına (fs, child_process vb.) erişmesi engellenir.
   - `contextIsolation: true` zorunludur. Preload betiği ile React DOM nesneleri izole bağlamlarda çalışır.
2. **ContextBridge Sınırları (`electron/preload.cjs`):**
   - Yalnızca tanımlı, güvenli fonksiyonlar `window.electronAPI` üzerinden dışa açılır:
     ```javascript
     contextBridge.exposeInMainWorld('electronAPI', {
       minimizeWindow: () => ipcRenderer.send('window:minimize'),
       maximizeWindow: () => ipcRenderer.send('window:maximize'),
       closeWindow: () => ipcRenderer.send('window:close'),
       isElectron: true
     });
     ```
   - Ham `ipcRenderer.sendSync` veya denetlenmeyen joker dinleyiciler kesinlikle dışa açılamaz.
3. **Pencere Açma ve Dış Bağlantı Koruması:**
   - Dış web adresleri masaüstü penceresi içinde açılmaz, sistem varsayılan tarayıcısına yönlendirilir:
     ```javascript
     mainWindow.webContents.setWindowOpenHandler(({ url }) => {
       shell.openExternal(url);
       return { action: 'deny' };
     });
     ```

---

## 2. Arka Plan Gateway Süreci Yönetimi (Lifecycle & Orphan Protection)

Masaüstü uygulaması başlatıldığında Gateway sunucusunu (`server/index.js`) arka planda çatal (fork) olarak çalıştırabilir:

- **Port Denetimi:** Önce TCP 3001 portuna bağlanmayı dener; eğer sunucu zaten açıksa mevcut örneği kullanır.
- **Temiz Kapatma:** Electron uygulaması kapandığında (`app.on('before-quit')`), çatal olarak açılmış olan `serverProcess` düzgün şekilde sonlandırılmalıdır (`serverProcess.kill('SIGTERM')`), böylece sistemde yetim (orphan) arka plan süreçleri kalmaz.

---

## 3. Paketleme ve Dağıtım Doğrulaması

- **Geliştirme Modunda Çalıştırma:**
  ```powershell
  npm run electron:dev
  ```
- **Windows NSIS Kurulum Paketi Üretimi:**
  ```powershell
  npm run app:dist
  ```
- Üretilen dağıtım dosyası `dist_installer/RemoteMM_Setup.exe` dizininde oluşturulur.

---

## 4. Tamamlanma Kriterleri

- Electron konsolunda güvensiz protokol veya `nodeIntegration` güvenlik uyarısı çıkmamalıdır.
- Pencere kontrolleri (Simge Durumu, Ekranı Kapla, Kapat) frameless/native başlık çubuğunda ContextBridge üzerinden gecikmesiz çalışmalıdır.
- Uygulama kapatıldığında Görev Yöneticisi'nde askıda kalan `node.exe` veya `electron.exe` süreci bulunmamalıdır.
