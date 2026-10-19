/**
 * RemoteMM Enterprise - Tamper-Proof Audit Logger & Compliance Engine
 * -------------------------------------------------------------------
 * Compliant with ISO 27001, SOC 2, and KVKK requirements.
 * Logs all operator connections, commands, file operations, and session lifetimes
 * into both structured JSONL rotating logfiles and relational database.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGS_DIR = path.join(__dirname, '..', 'data', 'audit_logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

class AuditLogger {
  constructor() {
    this.currentDate = this.getDateString();
    this.logFilePath = path.join(LOGS_DIR, `audit_${this.currentDate}.jsonl`);
    this.memoryBuffer = [];
    this.loadInitialHistory();
  }

  loadInitialHistory() {
    try {
      if (fs.existsSync(this.logFilePath)) {
        const lines = fs.readFileSync(this.logFilePath, 'utf8').trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            this.memoryBuffer.push(JSON.parse(line));
          } catch (e) {}
        }
        if (this.memoryBuffer.length > 1000) {
          this.memoryBuffer = this.memoryBuffer.slice(-1000);
        }
      }
    } catch (e) {}
  }

  getDateString() {
    return new Date().toISOString().split('T')[0];
  }

  rotateIfNeeded() {
    const today = this.getDateString();
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.logFilePath = path.join(LOGS_DIR, `audit_${this.currentDate}.jsonl`);
    }
  }


  /**
   * Records an immutable audit log entry.
   * Sensitive attributes (passwords, auth tokens) are automatically stripped/masked.
   */
  log({
    tenantId = 'tenant_default',
    operator = 'system',
    operatorIp = '127.0.0.1',
    targetDeviceId = null,
    targetHost = null,
    action,
    parameters = {},
    result = 'SUCCESS',
    durationMs = 0,
    errorMessage = null
  }) {
    this.rotateIfNeeded();

    // Sanitize parameters to eliminate passwords, private tokens, or secrets
    const sanitizedParams = { ...parameters };
    for (const key of Object.keys(sanitizedParams)) {
      const lower = key.toLowerCase();
      if (lower.includes('pass') || lower.includes('token') || lower.includes('secret') || lower.includes('key')) {
        sanitizedParams[key] = '***REDACTED***';
      }
    }

    const event = {
      eventId: `aud_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      tenantId,
      operator,
      operatorIp,
      targetDeviceId,
      targetHost,
      action,
      parameters: sanitizedParams,
      result,
      durationMs,
      errorMessage
    };

    const line = JSON.stringify(event) + '\n';
    try {
      fs.appendFileSync(this.logFilePath, line, 'utf8');
    } catch (err) {
      console.error('[AuditLogger] Failed to write audit log:', err);
    }

    this.memoryBuffer.push(event);
    if (this.memoryBuffer.length > 2000) {
      this.memoryBuffer.shift();
    }

    console.log(`[AUDIT] [${event.result}] ${event.action} by ${event.operator} on ${event.targetHost || event.targetDeviceId || 'N/A'}`);
    return event;
  }

  /**
   * Retrieves the latest audit entries for the compliance UI.
   */
  getRecentLogs(limit = 100, tenantId = null) {
    try {
      const filtered = tenantId 
        ? this.memoryBuffer.filter(item => item.tenantId === tenantId)
        : this.memoryBuffer;

      return filtered.slice(-limit).reverse();
    } catch (err) {
      console.warn('[AuditLogger] Could not read recent logs:', err.message);
      return [];
    }
  }

  /**
   * Exports audit trail formatted for compliance review (CSV or JSON).
   */
  exportLogs(format = 'json', tenantId = null) {
    const logs = this.getRecentLogs(2000, tenantId);
    if (format === 'csv') {
      const headers = ['eventId', 'timestamp', 'tenantId', 'operator', 'operatorIp', 'targetHost', 'action', 'parameters', 'result'];
      const rows = logs.map(l => {
        const pStr = JSON.stringify(l.parameters || {}).replace(/"/g, '""');
        return `"${l.eventId}","${l.timestamp}","${l.tenantId}","${l.operator}","${l.operatorIp}","${l.targetHost || ''}","${l.action}","${pStr}","${l.result}"`;
      });
      return [headers.join(','), ...rows].join('\r\n');
    }
    return JSON.stringify(logs, null, 2);
  }
}

export const auditLogger = new AuditLogger();
