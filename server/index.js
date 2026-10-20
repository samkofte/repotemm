import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { pushDeployAgent } from './deployer.js';
import { sendWakeOnLan, getMacFromIp } from './wol.js';
import { registry } from './registry.js';
import { auditLogger } from './audit.js';
import { authManager } from './auth.js';
import { releaseManager } from './releaseManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const CURRENT_AGENT_VERSION = 'RemoteMM Enterprise v5.0';

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.json());

// Dinamik install.ps1: Baglanan istemcinin Host basligina gore $ServerIp adresini otomatik enjekte et
app.get('/install.ps1', (req, res) => {
  const filePath = path.join(__dirname, '..', 'public', 'install.ps1');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('# install.ps1 not found');
  }
  let content = fs.readFileSync(filePath, 'utf8');
  const serverHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3001';
  content = content.replace(/\$ServerIp\s*=\s*['"][^'"]*['"]/, `$ServerIp = '${serverHost}'`);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(content);
});

// EXE ve diger public dosyalari HTTP ile sun
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/scripts', express.static(path.join(__dirname, '..', 'scripts')));
app.use(express.static(path.join(__dirname, '..', 'dist')));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'RemoteMM Enterprise Gateway & NOC Hub',
    port: PORT,
    agentVersion: CURRENT_AGENT_VERSION,
    registeredDevices: registry.getAllDevices().length,
    activeOperators: authManager.listOperators().length
  });
});

// Authentication: Operator Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const result = authManager.authenticate(username, password);
  if (!result.success) {
    auditLogger.logAction({
      tenantId: 'tenant_default',
      operatorId: username || 'unknown',
      actionType: 'OPERATOR_LOGIN_FAILED',
      parameters: { reason: result.reason },
      status: 'FAILED',
      operatorIp: req.ip
    });
    return res.status(401).json({ success: false, error: 'Kullanıcı adı veya şifre hatalı.', reason: result.reason });
  }

  auditLogger.logAction({
    tenantId: result.operator.tenantId,
    operatorId: result.operator.username,
    actionType: 'OPERATOR_LOGIN_SUCCESS',
    parameters: { role: result.operator.role },
    status: 'SUCCESS',
    operatorIp: req.ip
  });

  res.json({ success: true, token: result.token, operator: result.operator });
});

// Authentication: Validate Session Token / Profile
app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.query.token || '');
  const verified = authManager.verifySessionToken(token);
  if (!verified.valid) {
    return res.status(401).json({ success: false, error: 'Oturum geçersiz veya süresi dolmuş.', reason: verified.reason });
  }
  res.json({ success: true, operator: verified.payload });
});

// Operator Management: List operators
app.get('/api/operators', (req, res) => {
  const tenantId = req.query.tenantId || null;
  res.json({ success: true, operators: authManager.listOperators(tenantId) });
});

// Operator Management: Create operator
app.post('/api/operators', (req, res) => {
  try {
    const { tenantId, username, email, password, role } = req.body || {};
    const newOp = authManager.createOperator({ tenantId, username, email, password, role });
    auditLogger.logAction({
      tenantId: newOp.tenantId,
      operatorId: 'admin',
      actionType: 'OPERATOR_CREATED',
      parameters: { newOperator: newOp.username, role: newOp.role },
      status: 'SUCCESS',
      operatorIp: req.ip
    });
    res.json({ success: true, operator: newOp });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Operator Management: Delete operator
app.delete('/api/operators/:id', (req, res) => {
  try {
    const id = req.params.id;
    const ok = authManager.deleteOperator(id);
    if (!ok) return res.status(404).json({ success: false, error: 'Operatör bulunamadı.' });
    auditLogger.logAction({
      tenantId: 'tenant_default',
      operatorId: 'admin',
      actionType: 'OPERATOR_DELETED',
      parameters: { deletedOperatorId: id },
      status: 'SUCCESS',
      operatorIp: req.ip
    });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Central Registry: Get registered enterprise devices
app.get('/api/devices', (req, res) => {
  const tenantId = req.query.tenantId || null;
  res.json({ success: true, devices: registry.getAllDevices(tenantId) });
});

// Central Registry: Dynamic Heartbeat & Self-Registration Endpoint
app.post('/api/devices/heartbeat', (req, res) => {
  try {
    const { hwid, hostname, primaryIp, osName, cpuModel, totalRamMb, agentVersion, telemetry } = req.body;
    if (!hwid) {
      return res.status(400).json({ success: false, error: 'MISSING_HWID' });
    }

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    const effectiveIp = primaryIp || clientIp.replace(/^::ffff:/, '');

    const result = registry.registerOrAuthenticate({
      hwid,
      systemInfo: {
        hostname: hostname || 'Workstation',
        os: osName || 'Windows 11 Enterprise',
        cpu: cpuModel || 'Generic CPU',
        totalRamBytes: (totalRamMb || 8192) * 1024 * 1024,
        agentVersion: agentVersion || CURRENT_AGENT_VERSION
      }
    }, effectiveIp);

    if (telemetry) {
      registry.recordTelemetry(hwid, telemetry);
    }

    res.json({ success: true, device: result.device });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Compliance & Audit Logs: Get recent operations trail
app.get('/api/audit/logs', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const tenantId = req.query.tenantId || null;
  res.json({ success: true, logs: auditLogger.getRecentLogs(limit, tenantId) });
});

// Compliance & Audit Logs: Export full logs in CSV or JSON for ISO 27001 / KVKK audits
app.get('/api/audit/export', (req, res) => {
  const format = req.query.format === 'csv' ? 'csv' : 'json';
  const tenantId = req.query.tenantId || null;
  const content = auditLogger.exportLogs(format, tenantId);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="remotemm_audit_export.csv"');
    return res.send(content);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="remotemm_audit_export.json"');
  res.send(content);
});

// Wake-on-LAN (WoL) Paketi Gonder
app.post('/api/power/wol', async (req, res) => {
  const { mac, ip, broadcastIp } = req.body;
  try {
    let targetMac = mac;
    if (!targetMac && ip) {
      targetMac = await getMacFromIp(ip);
    }
    if (!targetMac) {
      return res.status(400).json({ success: false, error: 'MAC adresi bulunamadı veya belirtilmedi.' });
    }
    const result = await sendWakeOnLan(targetMac, broadcastIp || '255.255.255.255');
    console.log(`[WoL] Magic Packet sent to ${targetMac}`);
    res.json({ success: true, mac: targetMac, message: `Wake-on-LAN sihirli paketi ${targetMac} adresine gönderildi.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// IP uzerinden ARP ile MAC adresi bulma
app.get('/api/power/mac', async (req, res) => {
  const ip = req.query.ip;
  if (!ip) return res.status(400).json({ error: 'IP parametresi belirtilmedi' });
  const mac = await getMacFromIp(ip);
  res.json({ ip, mac: mac || null });
});

// Uzaktan Guc Yonetimi (Ajan uzerinden SYSTEM yetkisiyle veya Windows ag komutuyla)
app.post('/api/power/action', async (req, res) => {
  const { targetHost, port, action } = req.body;
  if (!targetHost || !action) return res.status(400).json({ error: 'Eksik parametreler' });

  const targetPort = parseInt(port || '6129', 10);
  let responded = false;

  // 1. Doğrudan agent soketine bağlanıp SYSTEM yetkisiyle POWER_ACTION gönder
  const sock = new net.Socket();
  sock.setTimeout(3000);

  sock.connect(targetPort, targetHost, () => {
    try {
      sock.write(JSON.stringify({ type: 'POWER_ACTION', action }) + '\n');
    } catch (e) {}
    setTimeout(() => {
      if (!responded) {
        responded = true;
        try { sock.destroy(); } catch (e) {}
        auditLogger.log({
          targetHost,
          action: `POWER_ACTION_${action.toUpperCase()}`,
          operator: 'admin',
          parameters: { method: 'agent_direct', port: targetPort }
        });
        return res.json({ success: true, method: 'agent_direct', action });
      }
    }, 250);
  });

  sock.on('error', () => {
    if (!responded) {
      responded = true;
      try { sock.destroy(); } catch (e) {}
      fallbackPowerRpc(targetHost, action, res);
    }
  });

  sock.on('timeout', () => {
    if (!responded) {
      responded = true;
      try { sock.destroy(); } catch (e) {}
      fallbackPowerRpc(targetHost, action, res);
    }
  });
});

function fallbackPowerRpc(targetHost, action, res) {
  const isLocal = targetHost === '127.0.0.1' || targetHost === 'localhost';
  let cmd = '';
  if (action === 'shutdown') {
    cmd = isLocal ? 'shutdown /s /f /t 1' : `shutdown /m \\\\${targetHost} /s /f /t 1`;
  } else if (action === 'reboot') {
    cmd = isLocal ? 'shutdown /r /f /t 1' : `shutdown /m \\\\${targetHost} /r /f /t 1`;
  } else if (action === 'abort') {
    cmd = isLocal ? 'shutdown /a' : `shutdown /m \\\\${targetHost} /a`;
  } else if (action === 'lock') {
    cmd = isLocal ? 'rundll32.exe user32.dll,LockWorkStation' : '';
  }

  if (cmd) {
    exec(cmd, (err, stdout, stderr) => {
      res.json({ success: !err, method: 'windows_rpc', out: stdout || '', err: stderr || '' });
    });
  } else {
    res.json({ success: false, error: 'Ajan kapalıyken bu güç eylemi uzaktan çalıştırılamaz.' });
  }
}

// ─── FLEET NOC: CANLI EKRAN ONIZLEME VE STATUS MOTORU ────────
export function checkPortOpen(host, port, timeout = 1200) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(timeout);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => { s.destroy(); resolve(false); });
    try {
      s.connect(port, host);
    } catch (e) {
      resolve(false);
    }
  });
}

function grabSingleFrame(host, port, timeout = 3500) {
  return new Promise((resolve) => {
    let socket = new net.Socket();
    let buffer = '';
    let resolved = false;
    let handshakeInfo = {};

    const cleanup = (resVal) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch (e) {}
      resolve(resVal);
    };

    socket.setTimeout(timeout);
    socket.once('timeout', () => cleanup(null));
    socket.once('error', () => cleanup(null));

    socket.connect(port, host, () => {
      try {
        socket.write(JSON.stringify({ type: 'MOUSE_INPUT', action: 'move', xPercent: 0.5, yPercent: 0.5 }) + '\n');
      } catch (e) {}
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 20 * 1024 * 1024) {
        cleanup(null);
        return;
      }
      let lines = buffer.split('\n');
      buffer = lines.pop();

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'HANDSHAKE_ACK') {
            handshakeInfo = {
              user: msg.user,
              hostname: msg.hostname,
              width: msg.screenWidth,
              height: msg.screenHeight
            };
          } else if (msg.type === 'SCREEN_FRAME' && msg.frame) {
            cleanup({
              frame: msg.frame,
              user: handshakeInfo.user || 'User',
              hostname: handshakeInfo.hostname || host,
              width: handshakeInfo.width || 1920,
              height: handshakeInfo.height || 1080
            });
            return;
          }
        } catch (e) {}
      }
    });
  });
}

const thumbnailCache = new Map();

// Tekil sunucu ekran anlik goruntusu (JSON Base64)
app.get('/api/fleet/snapshot', async (req, res) => {
  const host = req.query.host;
  const port = parseInt(req.query.port || '6129', 10);
  if (!host) return res.status(400).json({ error: 'host parametresi gerekli' });

  // 2 saniyelik onbellek kontrolu (veya fresh=true ise aninda canli yakala)
  const cached = thumbnailCache.get(host);
  if (cached && (Date.now() - cached.timestamp < 2000) && !req.query.fresh) {
    return res.json({ success: true, online: true, ...cached });
  }

  const isOnline = await checkPortOpen(host, port, 1000);
  if (!isOnline) {
    return res.json({ success: false, online: false, host, error: 'Makine kapalı veya port kapalı' });
  }

  try {
    const frameData = await grabSingleFrame(host, port, 2000);
    if (frameData) {
      const entry = {
        frame: frameData.frame,
        snapshot: frameData.frame,
        user: frameData.user,
        hostname: frameData.hostname,
        width: frameData.width,
        height: frameData.height,
        timestamp: Date.now()
      };
      thumbnailCache.set(host, entry);
      return res.json({ success: true, online: true, host, ...entry });
    } else {
      return res.json({ success: false, online: true, host, error: 'Ekran görüntüsü alınamadı' });
    }
  } catch (err) {
    return res.json({ success: false, online: false, host, error: err.message });
  }
});

// Dogrudan binary JPEG gorsel donduren endpoint (HTML <img> etiketleri icin)
app.get('/api/fleet/thumbnail', async (req, res) => {
  const host = req.query.host;
  const port = parseInt(req.query.port || '6129', 10);
  if (!host) return res.status(400).send('host parametresi gerekli');

  const cached = thumbnailCache.get(host);
  if (cached && (Date.now() - cached.timestamp < 8000) && cached.frame) {
    res.setHeader('Content-Type', 'image/jpeg');
    return res.send(Buffer.from(cached.frame, 'base64'));
  }

  const isOnline = await checkPortOpen(host, port, 1200);
  if (!isOnline) {
    return res.status(503).send('Makine çevrimdışı');
  }

  const frameData = await grabSingleFrame(host, port, 3000);
  if (frameData && frameData.frame) {
    thumbnailCache.set(host, {
      frame: frameData.frame,
      user: frameData.user,
      hostname: frameData.hostname,
      width: frameData.width,
      height: frameData.height,
      timestamp: Date.now()
    });
    res.setHeader('Content-Type', 'image/jpeg');
    return res.send(Buffer.from(frameData.frame, 'base64'));
  }
  res.status(500).send('Görüntü yakalanamadı');
});

// Coklu sunucularin online/offline durumlarini toplu sorgulama
app.post('/api/fleet/status', async (req, res) => {
  const hosts = req.body.hosts || [];
  const results = {};

  await Promise.all(hosts.map(async (h) => {
    const start = Date.now();
    const port = parseInt(h.port || '6129', 10);
    const ip = h.ip;
    const online = await checkPortOpen(ip, port, 1000);
    const latency = Date.now() - start;
    results[h.id || ip] = {
      online,
      latency: online ? latency : null,
      lastCheck: Date.now()
    };
  }));

  res.json({ success: true, statuses: results });
});

// Filo veya tekil ajan uzaktan guncelleme emri (Remote Fleet Upgrade)
app.post('/api/fleet/upgrade', async (req, res) => {
  const { targets = [], url, sha256, version = 'vNext', token } = req.body || {};

  // 1. RBAC & Oturum Dogrulama
  const authHeader = req.headers.authorization;
  const sessionToken = token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null);
  
  let operator = 'sec_admin';
  let operatorRole = 'SUPER_ADMIN';

  if (sessionToken) {
    const verified = authManager.verifySessionToken(sessionToken);
    if (!verified.valid) {
      return res.status(401).json({ success: false, error: 'INVALID_SESSION_TOKEN' });
    }
    operator = verified.payload.username;
    operatorRole = verified.payload.role;
  }

  // Salt okunur AUDITOR rolunun guncelleme yapmasi kesinlikle yasaktir
  if (operatorRole === 'AUDITOR') {
    auditLogger.logAction(operator, 'FLEET', 'FLEET_UPGRADE_REJECTED', 'PERMISSION_DENIED', { reason: 'AUDITOR_ROLE_CANNOT_UPGRADE' }, req);
    return res.status(403).json({ success: false, error: 'PERMISSION_DENIED', message: 'Denetçi (Auditor) rolü ajan güncelleyemez.' });
  }

  if (!url || !sha256) {
    return res.status(400).json({ success: false, error: 'MISSING_PARAMETERS', message: 'url ve sha256 alanları zorunludur.' });
  }

  // Hedef listesini normalize et
  let targetList = Array.isArray(targets) ? targets : [];
  if (req.body.host) {
    targetList.push({ ip: req.body.host, port: req.body.port || 6129 });
  }

  if (targetList.length === 0) {
    const registered = registry.getAllDevices();
    targetList = registered.map(d => ({ ip: d.ip, port: d.port || 6129, id: d.id, hostname: d.hostname }));
  }

  const results = [];
  const upgradePayload = JSON.stringify({
    type: 'AGENT_UPGRADE',
    url,
    sha256,
    version
  }) + '\n';

  for (const t of targetList) {
    const targetIp = t.ip || t.host;
    const targetPort = parseInt(t.port || 6129, 10);
    try {
      const client = new net.Socket();
      client.setTimeout(2000);
      const dispatched = await new Promise((resolve) => {
        client.connect(targetPort, targetIp, () => {
          client.write(upgradePayload);
          setTimeout(() => {
            client.destroy();
            resolve(true);
          }, 200);
        });
        client.on('error', () => {
          client.destroy();
          resolve(false);
        });
        client.on('timeout', () => {
          client.destroy();
          resolve(false);
        });
      });

      results.push({ target: `${targetIp}:${targetPort}`, dispatched });
      if (dispatched) {
        auditLogger.logAction(operator, targetIp, 'FLEET_UPGRADE_DISPATCHED', 'SUCCESS', { version, sha256: sha256.substring(0, 16) + '...' }, req);
      } else {
        auditLogger.logAction(operator, targetIp, 'FLEET_UPGRADE_FAILED', 'CONNECT_ERROR', { version }, req);
      }
    } catch (err) {
      results.push({ target: `${targetIp}:${targetPort}`, dispatched: false, error: err.message });
    }
  }

  res.json({
    success: true,
    message: `${results.filter(r => r.dispatched).length}/${targetList.length} cihaza güncelleme emri iletildi.`,
    results
  });
});

// ==========================================
// OTA Release Management & Fleet Auto-Update
// ==========================================

// En son yayinlanan surumu sorgula (Ajanlar tarafindan periyodik cagrilir)
app.get('/api/releases/latest', (req, res) => {
  const channel = req.query.channel || 'stable';
  const currentVersion = req.query.currentVersion || '1.0.0';
  const hwid = req.query.hwid || '';

  const result = releaseManager.getLatestRelease({ channel, currentVersion, hwid });
  if (result.updateAvailable && result.release) {
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3001';
    let dlUrl = result.release.downloadUrl;
    if (dlUrl.startsWith('/')) {
      dlUrl = `http://${hostHeader}${dlUrl}`;
    }
    return res.json({
      success: true,
      updateAvailable: true,
      release: {
        ...result.release,
        downloadUrl: dlUrl
      }
    });
  }

  res.json({
    success: true,
    updateAvailable: false,
    ...result
  });
});

// Yayinlanan tum surumleri listele
app.get('/api/releases', (req, res) => {
  res.json({
    success: true,
    releases: releaseManager.listReleases()
  });
});

// Yeni bir ajan surumu yayinla (Super Admin / Admin)
app.post('/api/releases/publish', (req, res) => {
  const operator = req.headers['x-operator-user'] || 'system';
  const role = (req.headers['x-operator-role'] || 'SUPER_ADMIN').toUpperCase();

  if (role === 'AUDITOR') {
    return res.status(403).json({ success: false, error: 'PERMISSION_DENIED', message: 'Denetçi rolü yeni sürüm yayınlayamaz.' });
  }

  try {
    const release = releaseManager.publishRelease(req.body);
    broadcastOtaRelease(release);
    auditLogger.logAction(operator, 'FLEET', 'RELEASE_PUBLISHED', 'SUCCESS', {
      version: release.version,
      channel: release.channel,
      sha256: release.sha256.substring(0, 16) + '...'
    }, req);

    res.json({
      success: true,
      message: `Sürüm v${release.version} başarıyla yayınlandı ve filoya duyuruldu.`,
      release
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Ajan guncelleme durum raporu (Success / Rollback / Failed)
app.post('/api/releases/report', (req, res) => {
  try {
    const report = releaseManager.recordReport(req.body);

    if (report.status === 'SUCCESS' && report.hwid && report.toVersion) {
      const dev = registry.getDeviceByHwid(report.hwid);
      if (dev) {
        dev.agentVersion = report.toVersion.startsWith('v') ? `RemoteMM Enterprise ${report.toVersion}` : `RemoteMM Enterprise v${report.toVersion}`;
      }
    }

    auditLogger.logAction(
      report.hwid,
      report.hostname || 'UNKNOWN',
      'AGENT_UPDATE_REPORT',
      report.status,
      { from: report.fromVersion, to: report.toVersion, error: report.errorMessage },
      req
    );

    res.json({ success: true, report });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Filo surum dagilimi ve OTA metrikleri
app.get('/api/fleet/release-stats', (req, res) => {
  const stats = releaseManager.getFleetStats(registry.getAllDevices());
  res.json({
    success: true,
    ...stats
  });
});

export function getBestLocalIp(targetHost = '') {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const alias of list) {
      if (alias.family === 'IPv4' && !alias.internal) {
        candidates.push({ name, ip: alias.address });
      }
    }
  }
  if (candidates.length === 0) return '127.0.0.1';

  if (targetHost && targetHost !== '127.0.0.1' && targetHost !== 'localhost') {
    const parts = targetHost.split('.');
    if (parts.length === 4) {
      const prefix = `${parts[0]}.${parts[1]}.`;
      const match = candidates.find(c => c.ip.startsWith(prefix));
      if (match) return match.ip;
    }
  }
  return candidates[0].ip;
}

// Uzak makine icin kurulum komutu uret (Kisa irm install.ps1 | iex komutu)
app.get('/api/setup-command', (req, res) => {
  const port = req.query.port || 6129;
  const targetHost = req.query.target || '';
  
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
  let serverHost;
  if (hostHeader) {
    serverHost = hostHeader;
  } else {
    const localIp = getBestLocalIp(targetHost);
    serverHost = `${localIp}:3001`;
  }

  const downloadUrl = `http://${serverHost}/RemoteMM_Agent.exe`;
  const cmd = `powershell -ExecutionPolicy Bypass -Command "irm http://${serverHost}/install.ps1 | iex"`;
  const gpoCmd = `powershell -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; & (irm http://${serverHost}/scripts/deploy-gpo.ps1) -GatewayServer 'http://${serverHost}'"`;
  const batchUrl = `http://${serverHost}/scripts/install-agent.bat`;
  const verifyUrl = `http://${serverHost}/scripts/verify-agent.ps1`;

  res.json({
    cmd,
    gpoCmd,
    batchUrl,
    verifyUrl,
    downloadUrl,
    serverIp: serverHost.split(':')[0],
    agentVersion: CURRENT_AGENT_VERSION
  });
});

app.post('/api/agent/deploy', async (req, res) => {
  const { targetHost, domain, username, password, port, force } = req.body;
  try {
    const result = await pushDeployAgent({ targetHost, domain, username, password, port, force });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

export function broadcastOtaRelease(release) {
  const msg = JSON.stringify({
    type: 'OTA_RELEASE_ANNOUNCED',
    version: release.version,
    channel: release.channel,
    sha256: release.sha256,
    downloadUrl: release.downloadUrl,
    mandatory: release.mandatory
  });
  if (wss && wss.clients) {
    for (const client of wss.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        try { client.send(msg); } catch (e) {}
      }
    }
  }
}

wss.on('connection', (ws, req) => {
  const params = new URLSearchParams(req.url.replace('/?', ''));
  const targetHost = params.get('host') || '127.0.0.1';
  const targetPort = parseInt(params.get('port') || '6129', 10);
  const domain = params.get('domain') || 'WORKGROUP';
  let username = params.get('username') || 'Administrator';
  const password = params.get('password') || '';
  const targetMac = params.get('mac') || '';
  const forceReinstall = params.get('force') === 'true' || params.get('reinstall') === 'true';
  const requireConsent = params.get('consent') === 'true';

  const sessionToken = params.get('token') || params.get('sessionToken') || '';
  let operatorRole = (params.get('role') || 'SUPER_ADMIN').toUpperCase();
  let tenantId = 'tenant_default';

  if (sessionToken) {
    const verified = authManager.verifySessionToken(sessionToken);
    if (verified.valid) {
      username = verified.payload.username;
      operatorRole = verified.payload.role;
      tenantId = verified.payload.tenantId || 'tenant_default';
      console.log(`[Gateway] Authenticated session token for operator: ${username} (Role: ${operatorRole})`);
    } else {
      console.warn(`[Gateway] Invalid or expired session token: ${verified.reason}. Falling back to default.`);
    }
  }

  console.log(`[Gateway] Initiating session to ${targetHost}:${targetPort} (operator: ${username}, role: ${operatorRole}, consent: ${requireConsent})...`);

  let isConnected = false;
  let isCancelled = false;
  let hasAttemptedPush = false;
  let hasAttemptedUpgrade = false;
  let tcpClient = new net.Socket();
  let buffer = '';

  const triggerDeployAndConnect = async (reasonMsg) => {
    if (hasAttemptedPush || isCancelled) return;
    hasAttemptedPush = true;

    if (operatorRole === 'AUDITOR') {
      sendErrorToConsole(ws, 'ERR_PERMISSION_DENIED', 'Erişim Engellendi: AUDITOR rolü hedef makineye uzaktan ajan yükleyemez.');
      auditLogger.logAction({
        tenantId: 'tenant_default',
        operatorId: username,
        targetHost,
        actionType: 'AGENT_DEPLOY_BLOCKED',
        parameters: { role: operatorRole },
        status: 'FAILED',
        errorMsg: 'Permission denied: AUDITOR is strictly read-only.'
      });
      return;
    }

    console.log(`[Gateway] ${reasonMsg} -> Running Remote Push Deployment on ${targetHost}...`);
    sendProgressToConsole(ws, reasonMsg);

    try {
      const deployRes = await pushDeployAgent({
        targetHost,
        domain,
        username,
        password,
        port: targetPort,
        force: true,
        onProgress: (msg) => sendProgressToConsole(ws, msg)
      });

      if (deployRes.success) {
        auditLogger.logAction({
          tenantId: 'tenant_default',
          operatorId: username,
          targetHost,
          actionType: 'AGENT_REMOTE_PUSH_DEPLOYED',
          parameters: { role: operatorRole, port: targetPort },
          status: 'SUCCESS'
        });
        sendProgressToConsole(ws, `Agent başarıyla hazırlandı! Ekrana bağlanılıyor...`);
        setTimeout(() => {
          if (!isCancelled) tryConnect();
        }, 1200);
      } else {
        sendErrorToConsole(ws, 'ERR_DEPLOY_FAILED', `Agent otomatik kurulamadı. Lütfen uzak makinede agent'ı başlatın.`);
      }
    } catch (deployErr) {
      console.log(`[Gateway] Push Deployment error: ${deployErr.message}`);
      sendErrorToConsole(ws, 'ERR_DEPLOY_ERROR', `Kurulum hatası: ${deployErr.message}`);
    }
  };

  const tryConnect = () => {
    if (isCancelled) return;

    buffer = ''; // Always start with a clean buffer
    if (tcpClient && !tcpClient.destroyed) {
      try { tcpClient.destroy(); } catch (e) {}
    }
    tcpClient = new net.Socket();
    tcpClient.setTimeout(4000);

    tcpClient.connect(targetPort, targetHost, () => {
      if (isCancelled) {
        tcpClient.destroy();
        return;
      }
      tcpClient.setTimeout(0); // Bağlantı kurulduktan sonra idle timeout'u tamamen kapat!
      tcpClient.setKeepAlive(true, 1000);
      tcpClient.setNoDelay(true);
      isConnected = true;
      console.log(`[Gateway] Connected directly to Agent on ${targetHost}:${targetPort}`);
    });

    let consecutiveDrops = 0;

    tcpClient.on('data', (chunk) => {
      if (isCancelled) return;
      buffer += chunk.toString('utf8');

      if (buffer.length > 25 * 1024 * 1024) {
        console.warn('[Gateway] Buffer exceeded 25MB without newline, resetting buffer');
        buffer = '';
        return;
      }

      let lineEnd;
      while ((lineEnd = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (!line) continue;

        let isFrame = false;
        try {
          if (line.charCodeAt(0) === 123) {
            if (line.includes('"SCREEN_FRAME"')) {
              isFrame = true;
            } else if (line.includes('"HANDSHAKE_ACK"')) {
              const parsed = JSON.parse(line);
              const remoteVer = parsed.agentVersion || 'v1.0';
              console.log(`[Gateway] Agent Handshake ACK: Remote version "${remoteVer}" connected on ${targetHost}:${targetPort}`);
              
              // Register device in Central Enterprise Registry
              registry.registerOrAuthenticate({
                hwid: parsed.hwid || `hwid_${targetHost.replace(/[^a-zA-Z0-9]/g, '_')}`,
                tenantId: parsed.tenantId || 'tenant_default',
                deviceToken: parsed.deviceToken,
                systemInfo: {
                  hostname: parsed.hostname || targetHost,
                  agentVersion: remoteVer,
                  primaryMac: parsed.macAddress || '',
                  os: parsed.os || 'Windows',
                  totalRamBytes: parsed.totalRamBytes || 0,
                  cpu: parsed.cpuModel || ''
                }
              }, targetHost);

              // Record in immutable audit log
              auditLogger.log({
                targetHost,
                action: 'SESSION_CONNECTED',
                operator: username,
                parameters: { agentVersion: remoteVer, hostname: parsed.hostname, role: operatorRole }
              });

              if (requireConsent) {
                tcpClient.write(JSON.stringify({
                  type: 'REQUEST_CONSENT',
                  operator: username,
                  timeout: 30
                }) + '\n');
                sendProgressToConsole(ws, 'Kullanıcıdan uzaktan erişim onayı bekleniyor (30 sn)...');
              }
            } else if (line.includes('"CONSENT_RESPONSE"')) {
              const parsed = JSON.parse(line);
              auditLogger.log({
                targetHost,
                operator: username,
                action: parsed.approved ? 'USER_CONSENT_APPROVED' : 'USER_CONSENT_REJECTED',
                parameters: { reason: parsed.reason, operator: parsed.operator },
                result: parsed.approved ? 'SUCCESS' : 'REJECTED'
              });
            } else if (line.includes('"DEVICE_HEARTBEAT"')) {
              const parsed = JSON.parse(line);
              if (parsed.hwid) {
                registry.recordTelemetry(parsed.hwid, parsed);
              }
            } else if (line.includes('"TELEMETRY_UPDATE"')) {
              const parsed = JSON.parse(line);
              const dev = registry.getDeviceByIpOrHost(targetHost);
              if (dev && parsed.data) {
                registry.recordTelemetry(dev.hwid, parsed.data);
              }
            } else if (line.includes('"NOC_THUMBNAIL"')) {
              const parsed = JSON.parse(line);
              if (parsed.frame) {
                thumbnailCache.set(targetHost, {
                  frame: parsed.frame,
                  snapshot: parsed.frame,
                  timestamp: Date.now()
                });
              }
            }
          }
        } catch (e) {}


        if (ws.readyState === WebSocket.OPEN && !isCancelled) {
          // Backpressure protection: eger ag/tarayici yetisemiyorsa bayat video karesini atla (256KB siniri)
          if (isFrame && ws.bufferedAmount > 256 * 1024) {
            consecutiveDrops++;
            if (consecutiveDrops % 2 === 0) {
              try {
                tcpClient.write(JSON.stringify({ type: 'THROTTLE_BACKPRESSURE', count: 1 }) + '\n');
              } catch (e) {}
            }
            continue;
          }
          consecutiveDrops = 0;
          ws.send(line);
        }
      }
    });

    tcpClient.on('timeout', handleConnectionFailure);
    tcpClient.on('error', handleConnectionFailure);

    tcpClient.on('close', () => {
      buffer = '';
      if (isCancelled || ws.readyState !== WebSocket.OPEN) return;
      
      if (!isConnected) return;
      isConnected = false;

      console.log(`[Gateway] Agent TCP connection closed. Reconnecting to ${targetHost}:${targetPort}...`);
      sendProgressToConsole(ws, 'Bağlantı yenileniyor, masaüstüne bağlanılıyor...');
      
      setTimeout(() => {
        if (!isCancelled && ws.readyState === WebSocket.OPEN) {
          tryConnect();
        }
      }, 1000);
    });
  };

  const handleConnectionFailure = async (err) => {
    if (isConnected || isCancelled) return;
    try { tcpClient.destroy(); } catch (e) {}

    // AUTOMATIC AGENT PUSH DEPLOYMENT & WAKE-ON-LAN IF PORT IS CLOSED & NOT YET ATTEMPTED
    if (!hasAttemptedPush) {
      // Eger hedef makine ulasilamazsa Wake-on-LAN sihirli paketi gonder
      try {
        let macToWake = targetMac;
        if (!macToWake) macToWake = await getMacFromIp(targetHost);
        if (macToWake) {
          console.log(`[Gateway] Hedef makine kapalı olabilir. Wake-on-LAN paketi (${macToWake}) gönderiliyor...`);
          sendProgressToConsole(ws, `⚡ Hedef makine kapalı olabilir. Wake-on-LAN paketi (${macToWake}) gönderildi...`);
          await sendWakeOnLan(macToWake).catch(() => {});
        }
      } catch (e) {}

      await triggerDeployAndConnect(`Agent kapalı veya kurulu değil (${targetHost}:${targetPort}). Otomatik kurulum başlatılıyor...`);
      return;
    }

    // If already attempted push or push failed, return crisp error
    let code = 'ERR_CONNECTION_FAILED';
    if (err && err.code === 'ECONNREFUSED') code = 'ERR_CONNECTION_REFUSED';
    if (err && err.code === 'ENOTFOUND') code = 'ERR_HOST_NOT_FOUND';
    if (err && err.code === 'ETIMEDOUT') code = 'ERR_CONNECTION_TIMED_OUT';

    sendErrorToConsole(ws, code, `Hedef makineye (${targetHost}:${targetPort}) bağlanılamadı. IP adresi ve Güvenlik Duvarı 6129 portunu kontrol edin.`);
  };

  ws.on('message', (message) => {
    if (isConnected && tcpClient.writable && !isCancelled) {
      const msgStr = message.toString();

      try {
        if (msgStr.charCodeAt(0) === 123) {
          const cmd = JSON.parse(msgStr);

          // RBAC Denetimi: AUDITOR rolü yalnızca salt-okunur (View-Only) erişim hakkına sahiptir
          const AUDITOR_FORBIDDEN = new Set([
            'MOUSE_INPUT', 'KEY_INPUT', 'BLACKOUT_SCREEN', 'LOCK_INPUT',
            'FS_UPLOAD', 'FS_DELETE', 'FS_EXEC', 'FS_MKDIR',
            'KILL_PROCESS', 'SERVICE_ACTION', 'POWER_ACTION', 'AGENT_UPGRADE',
            'CLIPBOARD_SET'
          ]);

          if (operatorRole === 'AUDITOR' && AUDITOR_FORBIDDEN.has(cmd.type)) {
            ws.send(JSON.stringify({
              type: 'PERMISSION_DENIED',
              action: cmd.type,
              role: operatorRole,
              message: 'AUDITOR rolü için bu işlem yetkilendirilmemiştir (Salt-Okunur Denetçi).'
            }));
            auditLogger.log({
              targetHost,
              operator: username,
              action: 'UNAUTHORIZED_ACCESS_BLOCKED',
              parameters: { attemptedAction: cmd.type, role: operatorRole },
              result: 'DENIED'
            });
            return;
          }

          // RBAC Denetimi: HELPDESK rolü kritik kapatma eylemlerini çalıştıramaz
          if (operatorRole === 'HELPDESK' && cmd.type === 'POWER_ACTION' && cmd.action === 'shutdown') {
            ws.send(JSON.stringify({
              type: 'PERMISSION_DENIED',
              action: 'POWER_ACTION_SHUTDOWN',
              role: operatorRole,
              message: 'HELPDESK rolü bilgisayarı tamamen kapatma (shutdown) yetkisine sahip değildir.'
            }));
            return;
          }

          if (cmd.type === 'FS_EXEC') {
            auditLogger.log({
              targetHost,
              operator: username,
              action: 'FILE_EXECUTE',
              parameters: { path: cmd.path }
            });
          } else if (cmd.type === 'FS_DELETE') {
            auditLogger.log({
              targetHost,
              operator: username,
              action: 'FILE_DELETE',
              parameters: { path: cmd.path }
            });
          } else if (cmd.type === 'FS_UPLOAD') {
            auditLogger.log({
              targetHost,
              operator: username,
              action: 'FILE_UPLOAD',
              parameters: { path: cmd.path, sha256: cmd.sha256 }
            });
          } else if (cmd.type === 'KILL_PROCESS') {
            auditLogger.log({
              targetHost,
              operator: username,
              action: 'PROCESS_TERMINATE',
              parameters: { pid: cmd.pid }
            });
          } else if (cmd.type === 'SERVICE_ACTION') {
            auditLogger.log({
              targetHost,
              operator: username,
              action: `SERVICE_${(cmd.action || '').toUpperCase()}`,
              parameters: { serviceName: cmd.serviceName }
            });
          } else if (cmd.type === 'REQUEST_CONSENT') {
            auditLogger.log({
              targetHost,
              operator: username,
              action: 'USER_CONSENT_REQUESTED',
              parameters: { timeout: cmd.timeout || 30 }
            });
          }
        }
      } catch (e) {}

      tcpClient.write(msgStr + '\n');
    }
  });


  ws.onclose = () => {
    isCancelled = true;
    try { tcpClient.destroy(); } catch (e) {}
  };

  // Eger kullanici zorla yeniden yukleme istemisse dogrudan deploy baslat, yoksa dogrudan baglan
  if (forceReinstall) {
    triggerDeployAndConnect(`Zorla yeniden kurulum ve güncelleme başlatılıyor (${targetHost})...`);
  } else {
    tryConnect();
  }
});

function sendProgressToConsole(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'DEPLOYMENT_PROGRESS',
      message,
      timestamp: Date.now()
    }));
  }
}

function sendErrorToConsole(ws, errorCode, errorMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'CONNECTION_ERROR',
      errorCode,
      errorMessage,
      timestamp: Date.now()
    }));
  }
}

server.listen(PORT, () => {
  console.log(`[Gateway Server] DameWare Console Gateway listening on port ${PORT} (Agent version: ${CURRENT_AGENT_VERSION})`);
});
