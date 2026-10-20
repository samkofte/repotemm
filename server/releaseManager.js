/**
 * RemoteMM Enterprise - Central Release Management & OTA Update Distribution Hub
 * -----------------------------------------------------------------------------
 * Provides semantic version management, canary rollouts, SHA-256 integrity checks,
 * update telemetry reporting, and real-time release broadcasting to agents.
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

let DatabaseSync = null;
try {
  const sqlite = await import('node:sqlite');
  DatabaseSync = sqlite.DatabaseSync;
} catch (e) {
  // Optional SQLite fallback
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = path.join(DATA_DIR, 'remotemm_enterprise.db');

export function compareVersions(v1, v2) {
  if (!v1 && !v2) return 0;
  if (!v1) return -1;
  if (!v2) return 1;

  const parse = v => (v || '')
    .toString()
    .replace(/^[^\d]*/, '')
    .split('.')
    .map(n => parseInt(n, 10) || 0);

  const p1 = parse(v1);
  const p2 = parse(v2);
  const maxLen = Math.max(p1.length, p2.length, 3);

  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export class ReleaseManager {
  constructor() {
    this.releases = new Map();
    this.reports = [];
    this.db = null;
    this.initDatabase();
    this.seedDefaultReleaseIfEmpty();
  }

  initDatabase() {
    if (DatabaseSync) {
      try {
        this.db = new DatabaseSync(DB_PATH);
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS releases (
            version TEXT PRIMARY KEY,
            channel TEXT DEFAULT 'stable',
            min_agent_version TEXT DEFAULT '1.0.0',
            sha256 TEXT NOT NULL,
            download_url TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_size INTEGER DEFAULT 0,
            release_notes TEXT,
            mandatory INTEGER DEFAULT 0,
            rollout_pct INTEGER DEFAULT 100,
            is_active INTEGER DEFAULT 1,
            created_at INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS update_reports (
            id TEXT PRIMARY KEY,
            hwid TEXT NOT NULL,
            hostname TEXT,
            from_version TEXT,
            to_version TEXT,
            status TEXT NOT NULL,
            error_message TEXT,
            reported_at INTEGER NOT NULL
          );
        `);
        this.loadFromDatabase();
      } catch (err) {
        console.warn(`[ReleaseManager] SQLite initialization warning: ${err.message}. Using in-memory fallback.`);
      }
    }
  }

  loadFromDatabase() {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(`SELECT * FROM releases ORDER BY created_at DESC`);
      const rows = stmt.all();
      for (const row of rows) {
        this.releases.set(row.version, {
          version: row.version,
          channel: row.channel,
          minAgentVersion: row.min_agent_version,
          sha256: row.sha256,
          downloadUrl: row.download_url,
          fileName: row.file_name,
          fileSize: Number(row.file_size),
          releaseNotes: row.release_notes,
          mandatory: Boolean(row.mandatory),
          rolloutPct: Number(row.rollout_pct),
          isActive: Boolean(row.is_active),
          createdAt: Number(row.created_at)
        });
      }

      const reportStmt = this.db.prepare(`SELECT * FROM update_reports ORDER BY reported_at DESC LIMIT 500`);
      this.reports = reportStmt.all().map(r => ({
        id: r.id,
        hwid: r.hwid,
        hostname: r.hostname,
        fromVersion: r.from_version,
        toVersion: r.to_version,
        status: r.status,
        errorMessage: r.error_message,
        reportedAt: Number(r.reported_at)
      }));
    } catch (err) {
      console.warn(`[ReleaseManager] Failed to load records from SQLite: ${err.message}`);
    }
  }

  seedDefaultReleaseIfEmpty() {
    if (this.releases.size > 0) return;

    const defaultExe = path.join(__dirname, '..', 'public', 'RemoteMM_Agent.exe');
    let sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    let fileSize = 0;

    if (fs.existsSync(defaultExe)) {
      try {
        const fileBuf = fs.readFileSync(defaultExe);
        fileSize = fileBuf.length;
        sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
      } catch (err) {
        console.warn(`[ReleaseManager] Error reading default binary for hash: ${err.message}`);
      }
    }

    this.publishRelease({
      version: '5.0.0',
      channel: 'stable',
      minAgentVersion: '1.0.0',
      sha256,
      downloadUrl: '/RemoteMM_Agent.exe',
      fileName: 'RemoteMM_Agent.exe',
      fileSize,
      releaseNotes: 'RemoteMM Enterprise v5.0 Baseline GA Release',
      mandatory: false,
      rolloutPct: 100
    });
  }

  publishRelease(releaseData) {
    const {
      version,
      channel = 'stable',
      minAgentVersion = '1.0.0',
      sha256,
      downloadUrl,
      fileName,
      fileSize = 0,
      releaseNotes = '',
      mandatory = false,
      rolloutPct = 100
    } = releaseData;

    if (!version || !sha256 || !downloadUrl) {
      throw new Error('version, sha256, and downloadUrl are required fields.');
    }

    const release = {
      version,
      channel,
      minAgentVersion,
      sha256: sha256.toLowerCase().trim(),
      downloadUrl,
      fileName: fileName || `RemoteMM_Agent_v${version}.exe`,
      fileSize: Number(fileSize),
      releaseNotes,
      mandatory: Boolean(mandatory),
      rolloutPct: Math.min(100, Math.max(0, Number(rolloutPct))),
      isActive: true,
      createdAt: Date.now()
    };

    this.releases.set(version, release);

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO releases (
            version, channel, min_agent_version, sha256, download_url,
            file_name, file_size, release_notes, mandatory, rollout_pct,
            is_active, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(version) DO UPDATE SET
            channel = excluded.channel,
            min_agent_version = excluded.min_agent_version,
            sha256 = excluded.sha256,
            download_url = excluded.download_url,
            file_name = excluded.file_name,
            file_size = excluded.file_size,
            release_notes = excluded.release_notes,
            mandatory = excluded.mandatory,
            rollout_pct = excluded.rollout_pct,
            is_active = excluded.is_active,
            created_at = excluded.created_at;
        `);
        stmt.run(
          release.version,
          release.channel,
          release.minAgentVersion,
          release.sha256,
          release.downloadUrl,
          release.fileName,
          release.fileSize,
          release.releaseNotes,
          release.mandatory ? 1 : 0,
          release.rolloutPct,
          release.isActive ? 1 : 0,
          release.createdAt
        );
      } catch (err) {
        console.warn(`[ReleaseManager] SQLite upsert failed: ${err.message}`);
      }
    }

    return release;
  }

  isDeviceInCanary(hwid, rolloutPct) {
    if (rolloutPct >= 100) return true;
    if (rolloutPct <= 0 || !hwid) return false;

    // Deterministic hash mod 100
    const hash = crypto.createHash('md5').update(hwid).digest('hex');
    const bucket = parseInt(hash.substring(0, 4), 16) % 100;
    return bucket < rolloutPct;
  }

  getLatestRelease({ channel = 'stable', currentVersion = '1.0.0', hwid = '' } = {}) {
    const candidates = Array.from(this.releases.values())
      .filter(r => r.isActive && r.channel === channel);

    if (candidates.length === 0) {
      return { updateAvailable: false, reason: 'NO_ACTIVE_RELEASES_FOR_CHANNEL' };
    }

    // Sort descending by semantic version
    candidates.sort((a, b) => compareVersions(b.version, a.version));
    const target = candidates[0];

    // Check if target is newer than agent's current version
    if (compareVersions(target.version, currentVersion) <= 0) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: target.version,
        reason: 'ALREADY_UP_TO_DATE'
      };
    }

    // Check minimum agent version prerequisite
    if (target.minAgentVersion && compareVersions(currentVersion, target.minAgentVersion) < 0) {
      return {
        updateAvailable: false,
        currentVersion,
        targetVersion: target.version,
        minAgentVersion: target.minAgentVersion,
        reason: 'MIN_AGENT_VERSION_NOT_MET'
      };
    }

    // Check canary rollout bucket
    if (!this.isDeviceInCanary(hwid, target.rolloutPct)) {
      return {
        updateAvailable: false,
        currentVersion,
        targetVersion: target.version,
        rolloutPct: target.rolloutPct,
        reason: 'CANARY_RING_NOT_SELECTED'
      };
    }

    return {
      updateAvailable: true,
      release: target
    };
  }

  listReleases() {
    return Array.from(this.releases.values())
      .sort((a, b) => compareVersions(b.version, a.version));
  }

  toggleRelease(version, isActive) {
    const rel = this.releases.get(version);
    if (!rel) return null;
    rel.isActive = Boolean(isActive);

    if (this.db) {
      try {
        const stmt = this.db.prepare(`UPDATE releases SET is_active = ? WHERE version = ?`);
        stmt.run(rel.isActive ? 1 : 0, version);
      } catch (err) {
        console.warn(`[ReleaseManager] Update is_active error: ${err.message}`);
      }
    }
    return rel;
  }

  recordReport({ hwid, hostname = '', fromVersion = '', toVersion = '', status, errorMessage = '' }) {
    if (!hwid || !status) {
      throw new Error('hwid and status are required for report.');
    }

    const report = {
      id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      hwid,
      hostname,
      fromVersion,
      toVersion,
      status: status.toUpperCase(), // SUCCESS, ROLLBACK, FAILED
      errorMessage: errorMessage || null,
      reportedAt: Date.now()
    };

    this.reports.unshift(report);
    if (this.reports.length > 500) {
      this.reports.pop();
    }

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO update_reports (
            id, hwid, hostname, from_version, to_version, status, error_message, reported_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
          report.id,
          report.hwid,
          report.hostname,
          report.fromVersion,
          report.toVersion,
          report.status,
          report.errorMessage,
          report.reportedAt
        );
      } catch (err) {
        console.warn(`[ReleaseManager] SQLite insert report error: ${err.message}`);
      }
    }

    return report;
  }

  getReports(limit = 50) {
    return this.reports.slice(0, limit);
  }

  getFleetStats(devices = []) {
    const versionCounts = {};
    for (const dev of devices) {
      const ver = (dev.agentVersion || dev.version || 'v5.0').replace(/^[^\d]*/, '') || '5.0.0';
      versionCounts[ver] = (versionCounts[ver] || 0) + 1;
    }

    const totalDevices = devices.length;
    const successReports = this.reports.filter(r => r.status === 'SUCCESS').length;
    const rollbackReports = this.reports.filter(r => r.status === 'ROLLBACK').length;
    const failedReports = this.reports.filter(r => r.status === 'FAILED').length;

    return {
      totalDevices,
      versionDistribution: versionCounts,
      reportsSummary: {
        success: successReports,
        rollback: rollbackReports,
        failed: failedReports
      },
      latestReleases: this.listReleases()
    };
  }
}

export const releaseManager = new ReleaseManager();
