import assert from 'assert';
import test from 'node:test';

test('Exponential Backoff Delay Calculation', () => {
  function getBackoffDelay(attempt, baseDelay = 1000, maxDelay = 15000) {
    return Math.min(maxDelay, baseDelay * Math.pow(1.5, attempt));
  }

  assert.strictEqual(getBackoffDelay(0), 1000);
  assert.strictEqual(getBackoffDelay(1), 1500);
  assert.strictEqual(getBackoffDelay(2), 2250);
  assert.strictEqual(getBackoffDelay(10), 15000);
});

test('Connection State Transition Machine', () => {
  const STATES = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    ERROR: 'error'
  };

  let currentState = STATES.DISCONNECTED;

  function transition(event) {
    switch (event) {
      case 'START_CONNECT':
        if (currentState === STATES.DISCONNECTED || currentState === STATES.ERROR) {
          currentState = STATES.CONNECTING;
        }
        break;
      case 'HANDSHAKE_SUCCESS':
        if (currentState === STATES.CONNECTING || currentState === STATES.RECONNECTING) {
          currentState = STATES.CONNECTED;
        }
        break;
      case 'CONNECTION_LOST':
        if (currentState === STATES.CONNECTED) {
          currentState = STATES.RECONNECTING;
        }
        break;
      case 'GIVE_UP':
        currentState = STATES.ERROR;
        break;
      case 'DISCONNECT':
        currentState = STATES.DISCONNECTED;
        break;
      default:
        break;
    }
    return currentState;
  }

  assert.strictEqual(transition('START_CONNECT'), STATES.CONNECTING);
  assert.strictEqual(transition('HANDSHAKE_SUCCESS'), STATES.CONNECTED);
  assert.strictEqual(transition('CONNECTION_LOST'), STATES.RECONNECTING);
  assert.strictEqual(transition('HANDSHAKE_SUCCESS'), STATES.CONNECTED);
  assert.strictEqual(transition('DISCONNECT'), STATES.DISCONNECTED);
});

test('Gateway Message Sanitization (Masking Sensitive Passwords)', () => {
  function maskSensitiveUrl(urlStr) {
    return urlStr.replace(/password=([^&]*)/gi, 'password=***');
  }

  const rawUrl = 'ws://localhost:3001/?host=172.17.130.182&username=Admin&password=SecretPass123&mac=00:15:5D';
  const masked = maskSensitiveUrl(rawUrl);

  assert.ok(!masked.includes('SecretPass123'));
  assert.ok(masked.includes('password=***'));
});

test('DeviceRegistry: Registration, Lookup, and Telemetry', async () => {
  const { registry } = await import('../server/registry.js');

  const testHwid = 'test_hwid_enterprise_99887766554433221100';
  const res = registry.registerOrAuthenticate({
    hwid: testHwid,
    tenantId: 'tenant_test_1',
    deviceToken: 'tok_dev_unit_test',
    systemInfo: {
      hostname: 'NOC-AGENT-UNIT-TEST',
      os: 'Windows 11 Enterprise',
      cpu: 'Intel Xeon 8-Core',
      totalRamBytes: 16 * 1024 * 1024 * 1024
    }
  }, '10.0.0.55');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.device.hostname, 'NOC-AGENT-UNIT-TEST');
  assert.strictEqual(res.device.totalRamMb, 16384);

  // Retrieve device
  const found = registry.getDeviceByHwid(testHwid);
  assert.ok(found);
  assert.strictEqual(found.primaryIp, '10.0.0.55');

  // Record telemetry
  const recorded = registry.recordTelemetry(testHwid, {
    cpuPercent: 42.5,
    usedRamMb: 8192,
    freeDiskGb: 120.4,
    activeUser: 'DomainAdmin',
    isLocked: false,
    uptimeSec: 3600
  });
  assert.strictEqual(recorded, true);
  assert.strictEqual(found.telemetry.cpuPercent, 42.5);
  assert.strictEqual(found.telemetry.activeUser, 'DomainAdmin');
});

test('AuditLogger: Parameter Sanitization and File Output', async () => {
  const { auditLogger } = await import('../server/audit.js');

  const loggedEvent = auditLogger.log({
    tenantId: 'tenant_test_1',
    operator: 'sec_admin',
    operatorIp: '192.168.1.100',
    targetHost: '10.0.0.55',
    action: 'POWER_ACTION_REBOOT',
    parameters: {
      force: true,
      user_password: 'SuperSecretAdminPassword123!',
      session_token: 'secret_token_abc123'
    },
    result: 'SUCCESS'
  });

  assert.strictEqual(loggedEvent.result, 'SUCCESS');
  assert.strictEqual(loggedEvent.action, 'POWER_ACTION_REBOOT');
  assert.strictEqual(loggedEvent.parameters.user_password, '***REDACTED***');
  assert.strictEqual(loggedEvent.parameters.session_token, '***REDACTED***');
  assert.strictEqual(loggedEvent.parameters.force, true);

  const recents = auditLogger.getRecentLogs(10, 'tenant_test_1');
  assert.ok(recents.length > 0);
  assert.strictEqual(recents[0].operator, 'sec_admin');
});

test('AuditLogger: CSV and JSON Export for ISO 27001 / KVKK Compliance', async () => {
  const { auditLogger } = await import('../server/audit.js');

  const csv = auditLogger.exportLogs('csv', 'tenant_test_1');
  assert.ok(typeof csv === 'string');
  assert.ok(csv.includes('eventId,timestamp,tenantId,operator'));
  assert.ok(csv.includes('POWER_ACTION_REBOOT'));
  assert.ok(csv.includes('sec_admin'));

  const jsonStr = auditLogger.exportLogs('json', 'tenant_test_1');
  const parsed = JSON.parse(jsonStr);
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.length > 0);
  assert.strictEqual(parsed[0].operator, 'sec_admin');
});

test('RBAC: AUDITOR Action Filtering and Permission Matrix', () => {
  const AUDITOR_FORBIDDEN = new Set([
    'MOUSE_INPUT', 'KEY_INPUT', 'BLACKOUT_SCREEN', 'LOCK_INPUT',
    'FS_UPLOAD', 'FS_DELETE', 'FS_EXEC', 'FS_MKDIR',
    'KILL_PROCESS', 'SERVICE_ACTION', 'POWER_ACTION', 'AGENT_UPGRADE',
    'CLIPBOARD_SET'
  ]);

  function isActionAllowed(role, action) {
    if (role === 'SUPER_ADMIN') return true;
    if (role === 'AUDITOR') return !AUDITOR_FORBIDDEN.has(action);
    if (role === 'HELPDESK' && action === 'POWER_ACTION_SHUTDOWN') return false;
    return true;
  }

  assert.strictEqual(isActionAllowed('AUDITOR', 'MOUSE_INPUT'), false);
  assert.strictEqual(isActionAllowed('AUDITOR', 'FS_UPLOAD'), false);
  assert.strictEqual(isActionAllowed('AUDITOR', 'KILL_PROCESS'), false);
  assert.strictEqual(isActionAllowed('AUDITOR', 'CLIPBOARD_SET'), false);
  assert.strictEqual(isActionAllowed('AUDITOR', 'SCREEN_VIEW'), true);

  assert.strictEqual(isActionAllowed('HELPDESK', 'POWER_ACTION_SHUTDOWN'), false);
  assert.strictEqual(isActionAllowed('HELPDESK', 'FS_UPLOAD'), true);

  assert.strictEqual(isActionAllowed('SUPER_ADMIN', 'POWER_ACTION_SHUTDOWN'), true);
});

test('DeviceRegistry: ALERT_OFFLINE Heartbeat Expiration (45s Inactivity)', async () => {
  const { DeviceRegistry } = await import('../server/registry.js');
  const reg = new DeviceRegistry(':memory:');

  const staleHwid = 'a'.repeat(64);
  reg.registerOrAuthenticate({
    hwid: staleHwid,
    tenantId: 'tenant_default',
    deviceToken: 'tok_dev_stale',
    systemInfo: {
      hostname: 'STALE-SRV-01',
      os: 'Windows Server 2022'
    }
  }, '192.168.10.88');

  // Telemetry set with lastSeen = 60 seconds ago
  const pastTime = Date.now() - 60000;
  const dev = reg.devices.get(staleHwid);
  dev.lastSeen = pastTime;
  dev.telemetry = {
    cpuPercent: 12.0,
    alerts: []
  };

  const allDevs = reg.getAllDevices();
  const foundStale = allDevs.find(d => d.hwid === staleHwid);
  assert.ok(foundStale);
  assert.ok(foundStale.telemetry.alerts.includes('ALERT_OFFLINE'), '45 saniye sessiz kalan makine ALERT_OFFLINE içermelidir');
});

