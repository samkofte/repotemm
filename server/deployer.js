import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const AGENT_EXE  = 'RemoteMM_Agent.exe';
const TASK_NAME  = 'RemoteMMAgent';
const REMOTE_DIR = 'C:\\RemoteMM';
const REMOTE_EXE = `${REMOTE_DIR}\\${AGENT_EXE}`;
const UNC_DIR    = host => `\\\\${host}\\C$\\RemoteMM`;

function run(cmd, timeout = 30000) {
  return new Promise(resolve => {
    const proc = exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: stdout || '', err: stderr || '' });
    });
    // Immediately close stdin so child processes like schtasks never hang waiting for input
    if (proc.stdin) {
      try { proc.stdin.end(); } catch (e) {}
    }
  });
}

function checkPortOpen(host, port, timeout = 1200) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(timeout);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => { s.destroy(); resolve(false); });
    try {
      const target = (host === '127.0.0.1' || host === 'localhost') ? 'host.docker.internal' : host;
      s.connect(port, target);
    } catch (e) {
      resolve(false);
    }
  });
}

// Birden fazla kullanici formatiyla SMB C$ bagla
async function smbConnect(host, domain, username, password) {
  const pw = password ? `"${password.replace(/"/g, '')}"` : '""';
  const formats = [
    username,
    domain && domain !== 'WORKGROUP' ? `${domain}\\${username}` : null,
    `.\\${username}`,
    `${host}\\${username}`
  ].filter(Boolean);

  for (const u of formats) {
    await run(`net use \\\\${host}\\C$ /delete /y`, 5000);
    await new Promise(r => setTimeout(r, 200));
    const r = await run(`net use \\\\${host}\\C$ ${pw} /USER:${u} /y`, 12000);
    if (r.ok) return { ok: true, user: u };
  }
  // Try without password if not connected
  if (!password) {
    const r = await run(`net use \\\\${host}\\C$ /y`, 8000);
    if (r.ok) return { ok: true, user: 'current_user' };
  }
  return { ok: false };
}

export async function pushDeployAgent({
  targetHost, domain = 'WORKGROUP', username = 'Administrator',
  password = '', port = 6129, force = false, onProgress
}) {
  const log = msg => { console.log(`[Deployer] ${msg}`); onProgress?.(msg); };
  const src = path.join(__dirname, '..', 'public', AGENT_EXE);
  const pw  = password || '';

  const isLocal = targetHost === '127.0.0.1' || targetHost === 'localhost' || targetHost === '::1';
  const targetHostParam = isLocal ? '' : `/s ${targetHost}`;
  const credsParam = (isLocal || !pw) ? '' : `/u "${username}" /p "${pw}"`;
  const remoteArgs = [targetHostParam, credsParam].filter(Boolean).join(' ');
  const remotePrefix = remoteArgs ? `${remoteArgs} ` : '';

  // ── 1. Eski Surecleri ve Servisleri Durdur (Kilitli Dosyayi Coz) ──
  log(`🛑 Adım 1: Mevcut süreç ve servis durduruluyor...`);
  if (isLocal) {
    await run(`sc.exe stop DWRCS`, 3000);
    await run(`sc.exe config DWRCS start= disabled`, 3000);
    await run(`sc.exe stop ${TASK_NAME}`, 5000);
    await run(`powershell -NoProfile -Command "Stop-Process -Name RemoteMM_Agent -Force -ErrorAction SilentlyContinue"`, 5000);
  } else {
    await run(`sc.exe \\\\${targetHost} stop DWRCS`, 3000);
    await run(`sc.exe \\\\${targetHost} config DWRCS start= disabled`, 3000);
    await run(`sc.exe \\\\${targetHost} stop ${TASK_NAME}`, 5000);
    // Remote taskkill attempt
    if (pw) {
      await run(`taskkill /S ${targetHost} /U "${username}" /P "${pw}" /F /IM ${AGENT_EXE}`, 5000);
    } else {
      await run(`taskkill /S ${targetHost} /F /IM ${AGENT_EXE}`, 5000);
    }
  }
  await run(`schtasks /delete ${remotePrefix}/tn "${TASK_NAME}" /f`, 10000);
  await new Promise(r => setTimeout(r, 600));

  // ── 2. SMB veya Yerel Kopyalama ───────────────────────────
  log(`📡 Adım 2: Dosya kopyalama yöntemi belirleniyor...`);
  let canDirectCopy = false;

  if (isLocal) {
    log(`ℹ️ Yerel makine algılandı. Doğrudan dosya kopyalanacak.`);
    canDirectCopy = true;
  } else {
    log(`📡 SMB C$ bağlantısı deneniyor...`);
    const smb = await smbConnect(targetHost, domain, username, pw);
    if (smb.ok) {
      log(`✅ SMB bağlandı (${smb.user}) — C$ erişimi var.`);
      canDirectCopy = true;
    } else {
      log(`⚠️ C$ erişimi yok — HTTP üzerinden indirme yöntemi kullanılacak.`);
    }
  }

  // ── 3. EXE kopyala veya HTTP ile indir ────────────────────
  if (canDirectCopy) {
    log(`📋 Adım 3: Agent kopyalanıyor → ${REMOTE_EXE}`);
    if (isLocal) {
      await run(`powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force -Path '${REMOTE_DIR}' | Out-Null; if (Test-Path '${REMOTE_EXE}') { Remove-Item '${REMOTE_EXE}.old' -Force -ErrorAction SilentlyContinue; Rename-Item '${REMOTE_EXE}' '${AGENT_EXE}.old' -Force -ErrorAction SilentlyContinue }; Copy-Item -Path '${src.replace(/'/g, "''")}' -Destination '${REMOTE_EXE}' -Force"`);
    } else {
      const unc = UNC_DIR(targetHost);
      await run(`powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force -Path '${unc}' | Out-Null; if (Test-Path '${unc}\\${AGENT_EXE}') { Remove-Item '${unc}\\${AGENT_EXE}.old' -Force -ErrorAction SilentlyContinue; Rename-Item '${unc}\\${AGENT_EXE}' '${AGENT_EXE}.old' -Force -ErrorAction SilentlyContinue }; Copy-Item -Path '${src.replace(/'/g, "''")}' -Destination '${unc}\\${AGENT_EXE}' -Force"`, 25000);
    }
  } else {
    log(`ℹ️ Adım 3: HTTP üzerinden agent indirme komutu gönderiliyor...`);
    let localIp = '127.0.0.1';
    const cands = [];
    for (const iface of Object.values(os.networkInterfaces())) {
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal) cands.push(alias.address);
      }
    }
    if (cands.length > 0) {
      const parts = targetHost.split('.');
      if (parts.length === 4) {
        const prefix = `${parts[0]}.${parts[1]}.`;
        const m = cands.find(ip => ip.startsWith(prefix));
        localIp = m || cands[0];
      } else {
        localIp = cands[0];
      }
    }
    const dlUrl = `http://${localIp}:3001/${AGENT_EXE}`;
    const psScript = `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; New-Item C:\\RemoteMM -ItemType Directory -Force | Out-Null; Stop-Process -Name RemoteMM_Agent -Force -ErrorAction SilentlyContinue; Invoke-WebRequest '${dlUrl}' -OutFile '${REMOTE_EXE}' -UseBasicParsing`;
    const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
    const dlCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${b64}`;
    
    log(`📥 İndirme görevi oluşturuluyor...`);
    await run(`schtasks /create ${remotePrefix}/tn "RemoteMM_Downloader" /tr "${dlCmd}" /sc ONSTART /ru "SYSTEM" /rl HIGHEST /f`, 15000);
    log(`🚀 İndirme görevi çalıştırılıyor...`);
    await run(`schtasks /run ${remotePrefix}/tn "RemoteMM_Downloader"`, 10000);
    await new Promise(r => setTimeout(r, 6000));
    await run(`schtasks /delete ${remotePrefix}/tn "RemoteMM_Downloader" /f`, 10000);
  }

  // ── 4. Windows Servisi / Gorevi Yapilandir ────────────────
  log(`⚙️ Adım 4: Windows Servisi yapılandırılıyor...`);
  if (!isLocal) {
    await run(`sc.exe \\\\${targetHost} create ${TASK_NAME} binPath= "${REMOTE_EXE}" start= auto DisplayName= "RemoteMM Support Agent"`, 10000);
    await run(`sc.exe \\\\${targetHost} config ${TASK_NAME} binPath= "${REMOTE_EXE}" start= auto`, 10000);
    await run(`sc.exe \\\\${targetHost} failure ${TASK_NAME} reset= 0 actions= restart/2000/restart/5000/restart/10000`, 10000);
  } else {
    await run(`sc.exe create ${TASK_NAME} binPath= "${REMOTE_EXE}" start= auto DisplayName= "RemoteMM Support Agent"`, 10000);
    await run(`sc.exe config ${TASK_NAME} binPath= "${REMOTE_EXE}" start= auto`, 10000);
    await run(`sc.exe failure ${TASK_NAME} reset= 0 actions= restart/2000/restart/5000/restart/10000`, 10000);
  }

  // ── 5. Servisi Başlat ───────────────────────────────────────
  log(`🚀 Adım 5: Servis başlatılıyor...`);
  const scStart = isLocal
    ? await run(`sc.exe start ${TASK_NAME}`, 10000)
    : await run(`sc.exe \\\\${targetHost} start ${TASK_NAME}`, 10000);

  if (scStart.ok) {
    log(`✅ Windows Servisi başarıyla başlatıldı!`);
  } else {
    log(`ℹ️ Servis bildirimi: ${(scStart.out || scStart.err).trim().split('\n')[0] || 'SCM tetiklendi'}`);
    
    // Fallback A: schtasks
    await run(`schtasks /create ${remotePrefix}/tn "${TASK_NAME}" /tr "${REMOTE_EXE}" /sc ONSTART /ru "SYSTEM" /rl HIGHEST /f`, 10000);
    await run(`schtasks /run ${remotePrefix}/tn "${TASK_NAME}"`, 10000);

    // Fallback B: If local, launch process directly
    if (isLocal) {
      log(`🚀 Yerel süreç doğrudan başlatılıyor...`);
      run(`powershell -NoProfile -Command "Start-Process '${REMOTE_EXE}'"`);
    } else {
      // Remote WMIC process start fallback
      const userArg = pw ? `/user:"${username}" /password:"${pw}"` : '';
      await run(`wmic /node:"${targetHost}" ${userArg} process call create "${REMOTE_EXE}"`, 10000);
    }
  }

  // ── 6. Port Dogrula (Native Node.js Socket ile Hızlı Kontrol) ──
  log(`🔍 Adım 6: Port ${port} bekleniyor...`);
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 600));
    if (await checkPortOpen(targetHost, port)) {
      log(`✅ Port ${port} açık — agent hazır!`);
      return { success: true };
    }
    if ((i + 1) % 4 === 0) {
      log(`⏳ Agent başlatılıyor... (${Math.round((i + 1) / 2)}s)`);
    }
  }

  // Son kontrol
  if (await checkPortOpen(targetHost, port)) {
    log(`✅ Port ${port} açık — agent hazır!`);
    return { success: true };
  }

  log(`❌ Port açılmadı. Hedef makinede "${REMOTE_EXE}" komutunu kontrol edin.`);
  return { success: false };
}
