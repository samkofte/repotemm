/**
 * RemoteMM Enterprise - Central Device Registry & Multi-Tenant Store
 * ------------------------------------------------------------------
 * Provides device tracking, approval status, tenant isolation,
 * and device token authentication using SQLite (or in-memory fallback).
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

let DatabaseSync = null;
try {
  const sqlite = await import('node:sqlite');
  DatabaseSync = sqlite.DatabaseSync;
} catch (e) {
  // SQLite optional fallback
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = path.join(DATA_DIR, 'remotemm_enterprise.db');

class DeviceRegistry {
  constructor() {
    this.devices = new Map();
    this.tenants = new Map();
    this.initDatabase();
  }

  initDatabase() {
    // Default tenant for immediate zero-config operation
    this.tenants.set('tenant_default', {
      id: 'tenant_default',
      name: 'Default Enterprise Tenant',
      enrollmentToken: 'enroll_sec_default_2026',
      createdAt: Date.now(),
      isActive: true
    });

    if (DatabaseSync) {
      try {
        this.db = new DatabaseSync(DB_PATH);
        this.db.exec(`

        CREATE TABLE IF NOT EXISTS tenants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          enrollment_token TEXT UNIQUE NOT NULL,
          created_at INTEGER,
          is_active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          hwid TEXT UNIQUE NOT NULL,
          hostname TEXT NOT NULL,
          primary_ip TEXT NOT NULL,
          mac_address TEXT,
          os_name TEXT,
          cpu_model TEXT,
          total_ram_mb INTEGER,
          agent_version TEXT,
          device_token TEXT NOT NULL,
          status TEXT DEFAULT 'APPROVED',
          last_seen INTEGER,
          created_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS device_telemetry (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL,
          cpu_percent REAL,
          used_ram_mb INTEGER,
          free_disk_gb REAL,
          active_user TEXT,
          is_locked INTEGER,
          uptime_sec INTEGER,
          recorded_at INTEGER
        );
      `);

      // Load initial devices from DB into fast memory cache
      const rows = this.db.prepare('SELECT * FROM devices').all();
      for (const row of rows) {
        this.devices.set(row.hwid, {
          id: row.id,
          tenantId: row.tenant_id,
          hwid: row.hwid,
          hostname: row.hostname,
          primaryIp: row.primary_ip,
          macAddress: row.mac_address,
          osName: row.os_name,
          cpuModel: row.cpu_model,
          totalRamMb: row.total_ram_mb,
          agentVersion: row.agent_version,
          deviceToken: row.device_token,
          status: row.status,
          lastSeen: row.last_seen,
          createdAt: row.created_at
        });
      }
      console.log(`[DeviceRegistry] Initialized SQLite store. Loaded ${rows.length} devices.`);
      } catch (err) {
        console.warn('[DeviceRegistry] SQLite unavailable or disabled, running high-performance in-memory mode:', err.message);
        this.db = null;
      }
    } else {
      this.db = null;
    }
  }

  registerOrAuthenticate(handshakePayload, remoteIp) {

    const {
      hwid,
      tenantId = 'tenant_default',
      deviceToken,
      enrollmentToken = '',
      systemInfo = {}
    } = handshakePayload;

    if (!hwid) {
      return { success: false, reason: 'ERR_MISSING_HWID' };
    }

    const now = Date.now();
    let dev = this.devices.get(hwid);

    if (dev) {
      // Validate device token if registered
      if (dev.deviceToken && deviceToken && dev.deviceToken !== deviceToken) {
        return { success: false, reason: 'ERR_INVALID_DEVICE_TOKEN' };
      }

      // Update dynamic telemetry and last seen
      dev.lastSeen = now;
      dev.primaryIp = remoteIp || dev.primaryIp;
      dev.hostname = systemInfo.hostname || dev.hostname;
      dev.agentVersion = systemInfo.agentVersion || dev.agentVersion;
      dev.macAddress = systemInfo.primaryMac || dev.macAddress;
      dev.osName = systemInfo.os || dev.osName;
      dev.totalRamMb = systemInfo.totalRamBytes ? Math.round(systemInfo.totalRamBytes / (1024 * 1024)) : dev.totalRamMb;
      dev.cpuModel = systemInfo.cpu || dev.cpuModel;

      this.persistDevice(dev);
      return { success: true, isNew: false, device: dev };
    }

    // New device registration
    const newId = `dev_${hwid.substring(0, 12)}`;
    const newDevice = {
      id: newId,
      tenantId,
      hwid,
      hostname: systemInfo.hostname || 'Unknown-PC',
      primaryIp: remoteIp || '127.0.0.1',
      macAddress: systemInfo.primaryMac || '',
      osName: systemInfo.os || 'Windows',
      cpuModel: systemInfo.cpu || 'Unknown CPU',
      totalRamMb: systemInfo.totalRamBytes ? Math.round(systemInfo.totalRamBytes / (1024 * 1024)) : 0,
      agentVersion: systemInfo.agentVersion || 'RemoteMM Enterprise v5.0',
      deviceToken: deviceToken || `tok_dev_${Math.random().toString(36).substr(2, 10)}`,
      status: 'APPROVED', // Default auto-approve for internal NOC deployment
      lastSeen: now,
      createdAt: now
    };

    this.devices.set(hwid, newDevice);
    this.persistDevice(newDevice);
    console.log(`[DeviceRegistry] Registered new enterprise device: ${newDevice.hostname} (${newDevice.primaryIp}) [HWID: ${hwid.substring(0, 8)}...]`);

    return { success: true, isNew: true, device: newDevice };
  }

  persistDevice(dev) {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(`
        INSERT INTO devices (
          id, tenant_id, hwid, hostname, primary_ip, mac_address,
          os_name, cpu_model, total_ram_mb, agent_version, device_token,
          status, last_seen, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?
        )
        ON CONFLICT(hwid) DO UPDATE SET
          hostname = excluded.hostname,
          primary_ip = excluded.primary_ip,
          mac_address = excluded.mac_address,
          os_name = excluded.os_name,
          cpu_model = excluded.cpu_model,
          total_ram_mb = excluded.total_ram_mb,
          agent_version = excluded.agent_version,
          status = excluded.status,
          last_seen = excluded.last_seen;
      `);
      stmt.run(
        dev.id, dev.tenantId, dev.hwid, dev.hostname, dev.primaryIp, dev.macAddress,
        dev.osName, dev.cpuModel, dev.totalRamMb, dev.agentVersion, dev.deviceToken,
        dev.status, dev.lastSeen, dev.createdAt
      );
    } catch (err) {
      console.warn('[DeviceRegistry] Database update error:', err.message);
    }
  }

  recordTelemetry(hwid, telemetry) {
    const dev = this.devices.get(hwid);
    if (!dev) return false;

    dev.lastSeen = Date.now();
    dev.telemetry = {
      cpuPercent: telemetry.cpuPercent || 0,
      usedRamMb: telemetry.usedRamMb || 0,
      freeDiskGb: telemetry.freeDiskGb || 0,
      activeUser: telemetry.activeUser || dev.telemetry?.activeUser || 'User',
      isLocked: Boolean(telemetry.isLocked),
      uptimeSec: telemetry.uptimeSec || 0,
      timestamp: Date.now()
    };

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO device_telemetry (
            device_id, cpu_percent, used_ram_mb, free_disk_gb, active_user, is_locked, uptime_sec, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
          dev.id, dev.telemetry.cpuPercent, dev.telemetry.usedRamMb, dev.telemetry.freeDiskGb,
          dev.telemetry.activeUser, dev.telemetry.isLocked ? 1 : 0, dev.telemetry.uptimeSec, Date.now()
        );
      } catch (e) {}
    }

    return true;
  }

  getAllDevices(tenantId = null) {
    const list = Array.from(this.devices.values());
    if (tenantId) {
      return list.filter(d => d.tenantId === tenantId);
    }
    return list;
  }

  getDeviceByHwid(hwid) {
    return this.devices.get(hwid) || null;
  }

  getDeviceByIpOrHost(ipOrHost) {
    return Array.from(this.devices.values()).find(
      d => d.primaryIp === ipOrHost || d.hostname.toLowerCase() === ipOrHost.toLowerCase()
    ) || null;
  }
}

export const registry = new DeviceRegistry();
