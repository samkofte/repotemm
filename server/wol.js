import dgram from 'dgram';
import { exec } from 'child_process';
import os from 'os';

/**
 * IP adresi ve alt ag maskesi/CIDR degerinden yonlendirmeli (directed) broadcast adresini hesaplar.
 * @param {string} ip - IPv4 adresi veya CIDR formatinda IP (orn: 192.168.1.55/24)
 * @param {string|number} maskOrCidr - Alt ag maskesi (255.255.255.0) veya CIDR sayisi (24)
 * @returns {string} Hesaplanmis broadcast adresi (orn: 192.168.1.255)
 */
export function calculateDirectedBroadcast(ip, maskOrCidr) {
  try {
    let cleanIp = ip.trim();
    let netmask = maskOrCidr;

    // CIDR destegi: e.g. "192.168.1.50/24"
    if (cleanIp.includes('/')) {
      const [parsedIp, cidr] = cleanIp.split('/');
      cleanIp = parsedIp;
      netmask = parseInt(cidr, 10);
    }

    // Sayisal CIDR maskesini dot-decimal formata cevir
    if (typeof netmask === 'number') {
      const cidr = Math.max(0, Math.min(32, netmask));
      const maskInt = (0xffffffff << (32 - cidr)) >>> 0;
      netmask = [
        (maskInt >>> 24) & 0xff,
        (maskInt >>> 16) & 0xff,
        (maskInt >>> 8) & 0xff,
        maskInt & 0xff
      ].join('.');
    }

    // Eger maske verilmemisse standart sinif varsayilanina bak
    if (!netmask) {
      const firstOctet = parseInt(cleanIp.split('.')[0], 10);
      if (firstOctet < 128) netmask = '255.0.0.0';         // Class A
      else if (firstOctet < 192) netmask = '255.255.0.0';  // Class B
      else netmask = '255.255.255.0';                      // Class C
    }

    const ipParts = cleanIp.split('.').map(Number);
    const maskParts = netmask.split('.').map(Number);
    const broadcastParts = [];
    for (let i = 0; i < 4; i++) {
      broadcastParts.push((ipParts[i] | (~maskParts[i] & 0xff)) >>> 0);
    }
    return broadcastParts.join('.');
  } catch (e) {
    return '255.255.255.255';
  }
}

/**
 * Sunucudaki tum aktif ag bagdastiricilarinin broadcast adreslerini ve hedef alt agi dondurur.
 */
export function getAllBroadcastAddresses(targetIp = '', customNetmask = '') {
  const addresses = new Set(['255.255.255.255']);

  try {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const iface of list) {
        if (iface.family === 'IPv4' && !iface.internal) {
          if (iface.netmask) {
            const bcast = calculateDirectedBroadcast(iface.address, iface.netmask);
            addresses.add(bcast);
          }
        }
      }
    }
  } catch (e) {}

  // Hedef IP ozel bir IPv4 ise, onun alt ag broadcast adresini ve dogrudan unicast adresini de ekle
  if (targetIp && targetIp.includes('.')) {
    const rawIp = targetIp.split('/')[0].trim();
    if (rawIp.split('.').length === 4) {
      const directedBcast = calculateDirectedBroadcast(targetIp, customNetmask);
      addresses.add(directedBcast);
      addresses.add(rawIp); // Unicast WoL (akilli switch'ler icin)
    }
  }

  return Array.from(addresses);
}

/**
 * Wake-on-LAN (WoL) Magic Packet uretir ve agdaki tum broadcast/unicast hedeflerine yayinlar.
 * Paket kayiplarini onlemek icin 40ms araliklarla 3 dalga halinde gonderilir.
 * @param {string} macAddress - Hedef bilgisayarin MAC adresi (orn: AA:BB:CC:DD:EE:FF)
 * @param {string} targetIp - Hedef IP adresi (alt ag tespiti icin)
 * @param {string} [netmask] - Istege bagli alt ag maskesi
 */
export function sendWakeOnLan(macAddress, targetIp = '', netmask = '') {
  return new Promise((resolve, reject) => {
    try {
      if (!macAddress || typeof macAddress !== 'string') {
        return reject(new Error('MAC adresi belirtilmedi'));
      }

      const cleanMac = macAddress.replace(/[^0-9a-fA-F]/g, '');
      if (cleanMac.length !== 12) {
        return reject(new Error(`Geçersiz MAC adresi formatı: ${macAddress}`));
      }

      // 6 bayt 0xFF ve ardindan 16 kez tekrarlanan MAC adresi (Toplam 102 bayt)
      const buf = Buffer.alloc(6 + 16 * 6);
      buf.fill(0xff, 0, 6);
      const macBuf = Buffer.from(cleanMac, 'hex');
      for (let i = 0; i < 16; i++) {
        macBuf.copy(buf, 6 + i * 6);
      }

      const targets = getAllBroadcastAddresses(targetIp, netmask);
      const ports = [9, 7];

      const client = dgram.createSocket('udp4');
      client.on('error', (err) => {
        try { client.close(); } catch (e) {}
        reject(err);
      });

      client.bind(0, () => {
        client.setBroadcast(true);

        const sendWave = () => {
          for (const addr of targets) {
            for (const port of ports) {
              try {
                client.send(buf, 0, buf.length, port, addr);
              } catch (e) {}
            }
          }
        };

        // 3 dalga halinde gonder (0ms, 40ms, 80ms)
        sendWave();
        setTimeout(sendWave, 40);
        setTimeout(() => {
          sendWave();
          setTimeout(() => {
            try { client.close(); } catch (e) {}
            resolve({
              success: true,
              mac: macAddress,
              targetsSent: targets
            });
          }, 50);
        }, 80);
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Windows ARP tablosundan ve PowerShell Get-NetNeighbor ile IP'ye karsilik gelen MAC adresini bulur.
 * @param {string} ip - Hedef IP adresi
 */
export async function getMacFromIp(ip) {
  if (!ip || ip === '127.0.0.1' || ip === 'localhost') return null;

  const findInArp = () => new Promise(resolve => {
    exec(`arp -a ${ip}`, { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const match = stdout.match(/([0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2})/);
      if (match) {
        resolve(match[1].replace(/-/g, ':').toUpperCase());
      } else {
        resolve(null);
      }
    });
  });

  const findInNeighbor = () => new Promise(resolve => {
    exec(`powershell -NoProfile -Command "(Get-NetNeighbor -IPAddress '${ip}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LinkLayerAddress)[0]"`, { timeout: 3500 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const clean = stdout.trim().replace(/-/g, ':').toUpperCase();
      if (clean && clean.length === 17) resolve(clean);
      else resolve(null);
    });
  });

  // 1. Once mevcut ARP tablosuna bak
  let mac = await findInArp();
  if (mac) return mac;

  // 2. PowerShell komsu tablosuna bak
  mac = await findInNeighbor();
  if (mac) return mac;

  // 3. Bulunamazsa bir kez ping atip ARP tablosunu guncellemeyi dene
  await new Promise(r => exec(`ping -n 1 -w 400 ${ip}`, { timeout: 1500 }, () => r()));
  mac = await findInArp();
  if (!mac) mac = await findInNeighbor();
  return mac;
}
