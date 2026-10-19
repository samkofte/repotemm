const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const net = require('net');
const { fork } = require('child_process');

let mainWindow = null;
let serverProcess = null;

function startGatewayServer() {
  const socket = net.createConnection(3001, '127.0.0.1');
  socket.on('connect', () => {
    socket.destroy();
    console.log('[Electron] Gateway server is already active on port 3001, using existing instance.');
  });
  socket.on('error', () => {
    socket.destroy();
    const serverPath = path.join(__dirname, '..', 'server', 'index.js');
    console.log(`[Electron] Forking background Gateway Server: ${serverPath}`);
    try {
      serverProcess = fork(serverPath, [], {
        env: { ...process.env, PORT: '3001' },
        stdio: 'inherit'
      });

      serverProcess.on('error', (err) => {
        console.error('[Electron] Server Process Error:', err);
      });
    } catch (err) {
      console.error('[Electron] Failed to fork Gateway Server:', err);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'RemoteMM Enterprise Console',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: true, // Native Windows titlebar and frame
    backgroundColor: '#090d16',
    show: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.show();
  mainWindow.focus();

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow.loadURL('http://localhost:3001');
    });
  } else {
    // Connect to Gateway server or fallback to dist/index.html
    mainWindow.loadURL('http://localhost:3001').catch(() => {
      const htmlPath = path.join(__dirname, '..', 'dist', 'index.html');
      mainWindow.loadFile(htmlPath).catch((err) => {
        console.error('[Electron] Error loading HTML file:', err);
      });
    });
  }

  // Handle external links safely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Window control IPC handlers
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

app.whenReady().then(() => {
  startGatewayServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
