/**
 * RemoteMM Enterprise - Operator Authentication & Session RBAC Engine
 * -------------------------------------------------------------------
 * Provides multi-tenant operator management, salted PBKDF2 password
 * hashing, timing-safe verification, and signed session tokens.
 * Adheres strictly to docs/ENTERPRISE_ENGINEERING_BIBLE.md Section 3.3.
 */

import crypto from 'node:crypto';
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

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = path.join(DATA_DIR, 'remotemm_enterprise.db');

// Session secret key (in production should be loaded from env or generated once)
const JWT_SECRET = process.env.RMM_SESSION_SECRET || 'remotemm_enterprise_sec_key_2026_jwt_token';

export const VALID_ROLES = ['SUPER_ADMIN', 'NOC_OPERATOR', 'HELPDESK', 'AUDITOR'];

export class AuthManager {
  constructor(dbInstance = null) {
    this.operators = new Map(); // username -> operator
    this.operatorsById = new Map(); // id -> operator
    this.db = dbInstance;
    this.initDatabase();
  }

  initDatabase() {
    if (!this.db && DatabaseSync) {
      try {
        this.db = new DatabaseSync(DB_PATH);
      } catch (err) {
        console.warn('[AuthManager] SQLite unavailable, running high-performance in-memory mode:', err.message);
        this.db = null;
      }
    }

    if (this.db) {
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS operators (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'NOC_OPERATOR', 'HELPDESK', 'AUDITOR')),
            is_mfa_enabled INTEGER DEFAULT 0,
            mfa_secret TEXT,
            created_at INTEGER
          );
        `);

        // Load existing operators into memory cache
        const rows = this.db.prepare('SELECT * FROM operators').all();
        for (const row of rows) {
          const op = {
            id: row.id,
            tenantId: row.tenant_id,
            username: row.username,
            email: row.email,
            passwordHash: row.password_hash,
            role: row.role,
            isMfaEnabled: Boolean(row.is_mfa_enabled),
            mfaSecret: row.mfa_secret,
            createdAt: row.created_at
          };
          this.operators.set(op.username.toLowerCase(), op);
          this.operatorsById.set(op.id, op);
        }
        console.log(`[AuthManager] Initialized operator store. Loaded ${rows.length} operators.`);
      } catch (err) {
        console.error('[AuthManager] Database initialization failed:', err.message);
      }
    }

    // Seed default enterprise operators if not present
    this.seedDefaultOperators();
  }

  hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `pbkdf2:sha512:100000:${salt}:${hash}`;
  }

  verifyPassword(password, storedHash) {
    if (!password || !storedHash) return false;
    try {
      const parts = storedHash.split(':');
      if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
      const iterations = parseInt(parts[2], 10);
      const salt = parts[3];
      const originalHash = parts[4];

      const verifyHash = crypto.pbkdf2Sync(password, salt, iterations, 64, parts[1]).toString('hex');
      return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(verifyHash, 'hex'));
    } catch {
      return false;
    }
  }

  createSessionToken(operator, ttlSec = 86400) {
    const payload = {
      operatorId: operator.id,
      tenantId: operator.tenantId,
      username: operator.username,
      role: operator.role,
      exp: Date.now() + ttlSec * 1000
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(payloadB64).digest('base64url');
    return `rmm_sess.${payloadB64}.${signature}`;
  }

  verifySessionToken(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, reason: 'ERR_EMPTY_TOKEN' };
    }
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'rmm_sess') {
      return { valid: false, reason: 'ERR_INVALID_TOKEN_FORMAT' };
    }

    const payloadB64 = parts[1];
    const signature = parts[2];

    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(payloadB64).digest('base64url');
    if (signature.length !== expectedSig.length) {
      return { valid: false, reason: 'ERR_INVALID_SIGNATURE' };
    }

    const isSigMatch = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
    if (!isSigMatch) {
      return { valid: false, reason: 'ERR_SIGNATURE_MISMATCH' };
    }

    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
      if (payload.exp && Date.now() > payload.exp) {
        return { valid: false, reason: 'ERR_TOKEN_EXPIRED' };
      }
      return { valid: true, payload };
    } catch {
      return { valid: false, reason: 'ERR_CORRUPT_PAYLOAD' };
    }
  }

  seedDefaultOperators() {
    const defaultOps = [
      {
        username: 'admin',
        email: 'admin@remotemm.enterprise',
        password: 'admin',
        role: 'SUPER_ADMIN'
      },
      {
        username: 'operator1',
        email: 'operator@remotemm.enterprise',
        password: 'operator_pass_2026',
        role: 'NOC_OPERATOR'
      },
      {
        username: 'helpdesk1',
        email: 'helpdesk@remotemm.enterprise',
        password: 'helpdesk_pass_2026',
        role: 'HELPDESK'
      },
      {
        username: 'auditor1',
        email: 'auditor@remotemm.enterprise',
        password: 'auditor_pass_2026',
        role: 'AUDITOR'
      }
    ];

    for (const def of defaultOps) {
      if (!this.operators.has(def.username.toLowerCase())) {
        this.createOperator({
          tenantId: 'tenant_default',
          username: def.username,
          email: def.email,
          password: def.password,
          role: def.role
        });
      }
    }
  }

  authenticate(username, password) {
    if (!username || !password) {
      return { success: false, reason: 'ERR_MISSING_CREDENTIALS' };
    }
    const op = this.operators.get(username.toLowerCase().trim());
    if (!op) {
      return { success: false, reason: 'ERR_USER_NOT_FOUND' };
    }

    if (!this.verifyPassword(password, op.passwordHash)) {
      return { success: false, reason: 'ERR_INVALID_PASSWORD' };
    }

    const token = this.createSessionToken(op);
    return {
      success: true,
      token,
      operator: {
        id: op.id,
        tenantId: op.tenantId,
        username: op.username,
        email: op.email,
        role: op.role,
        isMfaEnabled: op.isMfaEnabled,
        createdAt: op.createdAt
      }
    };
  }

  createOperator({ tenantId = 'tenant_default', username, email, password, role = 'NOC_OPERATOR' }) {
    if (!username || !password || !email) {
      throw new Error('Username, email and password are required');
    }
    const cleanUsername = username.trim();
    if (this.operators.has(cleanUsername.toLowerCase())) {
      throw new Error(`Operator '${cleanUsername}' already exists`);
    }
    const cleanRole = role.toUpperCase();
    if (!VALID_ROLES.includes(cleanRole)) {
      throw new Error(`Invalid role '${role}'. Must be one of: ${VALID_ROLES.join(', ')}`);
    }

    const id = `op_${cleanUsername.toLowerCase()}_${Math.random().toString(36).substr(2, 6)}`;
    const passwordHash = this.hashPassword(password);
    const createdAt = Date.now();

    const operator = {
      id,
      tenantId,
      username: cleanUsername,
      email: email.trim(),
      passwordHash,
      role: cleanRole,
      isMfaEnabled: false,
      mfaSecret: null,
      createdAt
    };

    this.operators.set(cleanUsername.toLowerCase(), operator);
    this.operatorsById.set(id, operator);

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO operators (id, tenant_id, username, email, password_hash, role, is_mfa_enabled, mfa_secret, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
          operator.id, operator.tenantId, operator.username, operator.email,
          operator.passwordHash, operator.role, 0, null, operator.createdAt
        );
      } catch (err) {
        console.warn(`[AuthManager] Failed to persist operator to DB:`, err.message);
      }
    }

    return {
      id: operator.id,
      tenantId: operator.tenantId,
      username: operator.username,
      email: operator.email,
      role: operator.role,
      isMfaEnabled: operator.isMfaEnabled,
      createdAt: operator.createdAt
    };
  }

  listOperators(tenantId = null) {
    let list = Array.from(this.operators.values());
    if (tenantId) {
      list = list.filter(op => op.tenantId === tenantId);
    }
    return list.map(op => ({
      id: op.id,
      tenantId: op.tenantId,
      username: op.username,
      email: op.email,
      role: op.role,
      isMfaEnabled: op.isMfaEnabled,
      createdAt: op.createdAt
    }));
  }

  deleteOperator(id) {
    const op = this.operatorsById.get(id);
    if (!op) return false;
    if (op.username.toLowerCase() === 'admin') {
      throw new Error('Root administrator account cannot be deleted');
    }
    this.operators.delete(op.username.toLowerCase());
    this.operatorsById.delete(id);

    if (this.db) {
      try {
        this.db.prepare('DELETE FROM operators WHERE id = ?').run(id);
      } catch (err) {
        console.warn(`[AuthManager] Failed to delete operator from DB:`, err.message);
      }
    }
    return true;
  }
}

export const authManager = new AuthManager();
