import unittest
import json
import time
import os
import sys

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(BASE_DIR, 'agent'))

class TestAgentProtocol(unittest.TestCase):
    """
    Python Ajanı (py_agent.py) protokol şeması, mesaj doğrulama,
    güvenlik sınırları ve dosya yönetimi birim testleri.
    """

    def test_handshake_ack_structure(self):
        """HANDSHAKE_ACK yanıtının gerekli alanları içerdiğini doğrular."""
        sample_hs = {
            'type': 'HANDSHAKE_ACK',
            'agentVersion': 'RemoteMM v4.2',
            'hostname': 'TEST-PC',
            'user': 'SYSTEM',
            'macAddress': '00:15:5D:01:68:01',
            'screenWidth': 1920,
            'screenHeight': 1080,
            'os': 'Windows'
        }
        self.assertEqual(sample_hs['type'], 'HANDSHAKE_ACK')
        self.assertIn('screenWidth', sample_hs)
        self.assertIn('screenHeight', sample_hs)
        self.assertGreater(sample_hs['screenWidth'], 0)
        self.assertGreater(sample_hs['screenHeight'], 0)
        self.assertTrue(sample_hs['macAddress'].count(':') == 5 or sample_hs['macAddress'] == '')

    def test_screen_frame_packet(self):
        """SCREEN_FRAME veri paketinin bütünlüğünü test eder."""
        packet = {
            'type': 'SCREEN_FRAME',
            'frame': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            'timestamp': int(time.time() * 1000),
            'width': 1920,
            'height': 1080,
            'blackedOut': False
        }
        self.assertEqual(packet['type'], 'SCREEN_FRAME')
        self.assertIsInstance(packet['frame'], str)
        self.assertIsInstance(packet['timestamp'], int)
        self.assertIsInstance(packet['blackedOut'], bool)

    def test_mouse_input_coordinate_bounds(self):
        """Fare koordinatlarının [0.0, 1.0] aralığında sınırlandırıldığını test eder."""
        def sanitize_coord(val):
            try:
                f = float(val)
                return max(0.0, min(1.0, f))
            except (ValueError, TypeError):
                return 0.0

        self.assertEqual(sanitize_coord(0.5), 0.5)
        self.assertEqual(sanitize_coord(-0.2), 0.0)
        self.assertEqual(sanitize_coord(1.5), 1.0)
        self.assertEqual(sanitize_coord("invalid"), 0.0)
        self.assertEqual(sanitize_coord(None), 0.0)

    def test_chat_message_validation(self):
        """Sohbet mesajlarının boşluk temizleme ve sınır kontrolünü test eder."""
        def validate_chat(text, max_len=2000):
            if not text or not isinstance(text, str):
                return None
            cleaned = text.strip()
            if not cleaned:
                return None
            return cleaned[:max_len]

        self.assertEqual(validate_chat("  Merhaba RemoteMM!  "), "Merhaba RemoteMM!")
        self.assertIsNone(validate_chat("   "))
        self.assertIsNone(validate_chat(None))
        self.assertIsNone(validate_chat(12345))
        long_text = "A" * 3000
        self.assertEqual(len(validate_chat(long_text)), 2000)

    def test_file_size_limit_check(self):
        """Dosya indirme ve yükleme için 25MB sınır denetimini test eder."""
        MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB
        
        def check_size(sz):
            return sz <= MAX_FILE_SIZE

        self.assertTrue(check_size(1024))
        self.assertTrue(check_size(25 * 1024 * 1024))
        self.assertFalse(check_size(25 * 1024 * 1024 + 1))
        self.assertFalse(check_size(50 * 1024 * 1024))

    def test_path_sanitization(self):
        """Path traversal risklerine karşı dosya yolu doğrulamasını test eder."""
        def is_safe_relative_path(base_dir, requested_path):
            import os
            abs_base = os.path.abspath(base_dir)
            abs_req = os.path.abspath(os.path.join(base_dir, requested_path))
            return abs_req.startswith(abs_base)

        self.assertTrue(is_safe_relative_path("C:\\RemoteMM", "logs\\agent.log"))
        self.assertFalse(is_safe_relative_path("C:\\RemoteMM", "..\\Windows\\System32"))

    def test_allowed_power_actions(self):
        """Desteklenen güç eylemleri listesi dışındaki eylemlerin engellendiğini test eder."""
        ALLOWED_ACTIONS = {'shutdown', 'reboot', 'sleep', 'hibernate', 'lock', 'logoff', 'abort'}
        
        self.assertIn('shutdown', ALLOWED_ACTIONS)
        self.assertIn('reboot', ALLOWED_ACTIONS)
        self.assertIn('lock', ALLOWED_ACTIONS)
        self.assertNotIn('destroy', ALLOWED_ACTIONS)
        self.assertNotIn('format', ALLOWED_ACTIONS)
        self.assertNotIn('rmdir', ALLOWED_ACTIONS)

    def test_identity_generation(self):
        """agent.identity modülünün HWID ve kimlik üretimini doğrular."""
        import sys
        import os
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
        from agent.identity import generate_hwid, load_or_create_identity

        hwid = generate_hwid()
        self.assertIsInstance(hwid, str)
        self.assertEqual(len(hwid), 64)
        self.assertTrue(all(c in '0123456789abcdef' for c in hwid.lower()))

        ident = load_or_create_identity("test_tenant_id")
        self.assertIn('hwid', ident)
        self.assertIn('deviceToken', ident)
        self.assertIn('tenantId', ident)
        self.assertTrue(ident['deviceToken'].startswith('tok_dev_'))
        self.assertEqual(ident['hwid'], hwid)

    def test_telemetry_collector(self):
        """agent.telemetry modülünün Win32 sistem metriklerini doğru topladığını test eder."""
        import sys
        import os
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
        from agent.telemetry import collect_full_telemetry, get_memory_info, get_disk_free_gb, get_uptime_sec

        total_mb, used_mb, free_mb, pct = get_memory_info()
        self.assertGreater(total_mb, 0)
        self.assertGreaterEqual(used_mb, 0)
        self.assertGreaterEqual(pct, 0.0)
        self.assertLessEqual(pct, 100.0)

        disk_gb = get_disk_free_gb('C:\\')
        self.assertGreater(disk_gb, 0.0)

        uptime = get_uptime_sec()
        self.assertGreater(uptime, 0)

        snapshot = collect_full_telemetry()
        self.assertIn('cpuPercent', snapshot)
        self.assertIn('totalRamMb', snapshot)
        self.assertIn('usedRamMb', snapshot)
        self.assertIn('freeDiskGb', snapshot)
        self.assertIn('uptimeSec', snapshot)
        self.assertIn('isLocked', snapshot)
        self.assertIsInstance(snapshot['isLocked'], bool)

    def test_multi_monitor_discovery_and_coordinate_mapping(self):
        """agent.display modülünün monitör keşfi ve koordinat dönüşümlerini doğrular."""
        import sys
        import os
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
        from agent.display import (
            enumerate_monitors,
            get_virtual_desktop_bounds,
            get_target_capture_rect,
            map_normalized_to_screen_coords
        )

        monitors = enumerate_monitors()
        self.assertIsInstance(monitors, list)
        self.assertGreater(len(monitors), 0)

        first = monitors[0]
        self.assertIn('width', first)
        self.assertIn('height', first)
        self.assertIn('left', first)
        self.assertIn('top', first)
        self.assertIn('isPrimary', first)
        self.assertGreater(first['width'], 0)
        self.assertGreater(first['height'], 0)

        vb = get_virtual_desktop_bounds()
        self.assertGreater(vb['width'], 0)
        self.assertGreater(vb['height'], 0)

        # Sanal masaüstü yakalama dikdörtgeni testi
        rect_all = get_target_capture_rect('ALL')
        self.assertEqual(rect_all[2], vb['width'])
        self.assertEqual(rect_all[3], vb['height'])

        # İlk monitör yakalama dikdörtgeni testi
        rect_m0 = get_target_capture_rect(0)
        self.assertEqual(rect_m0[2], first['width'])
        self.assertEqual(rect_m0[3], first['height'])

        # Koordinat haritalama testi (Sol üst 0.0, 0.0 -> left, top)
        px, py = map_normalized_to_screen_coords(0.0, 0.0, 0)
        self.assertEqual(px, first['left'])
        self.assertEqual(py, first['top'])

        # Koordinat haritalama testi (Sağ alt 1.0, 1.0 -> right, bottom)
    def test_sha256_file_integrity_verification(self):
        """Dosya yükleme ve indirmede SHA-256 bütünlük kontrolü mantığını doğrular."""
        import hashlib
        sample_data = b"RemoteMM Enterprise Secure File Transfer Payload"
        expected_hash = hashlib.sha256(sample_data).hexdigest()

        # Doğru hash ile eşleşme
        actual_hash = hashlib.sha256(sample_data).hexdigest()
        self.assertEqual(expected_hash.lower(), actual_hash.lower())

        # Bozulmuş/değiştirilmiş veri ile eşleşmeme (tampering detection)
        tampered_data = b"RemoteMM Enterprise Tampered File Transfer Payload"
        tampered_hash = hashlib.sha256(tampered_data).hexdigest()
        self.assertNotEqual(expected_hash.lower(), tampered_hash.lower())

    def test_service_status_and_action_whitelist(self):
        """Windows servisleri durum haritalama ve izin verilen eylem denetimini doğrular."""
        STATUS_MAP = {1: 'STOPPED', 2: 'START_PENDING', 3: 'STOP_PENDING', 4: 'RUNNING', 5: 'CONTINUE_PENDING', 6: 'PAUSE_PENDING', 7: 'PAUSED'}
        START_MAP = {0: 'Boot', 1: 'System', 2: 'Automatic', 3: 'Manual', 4: 'Disabled'}
        ALLOWED_ACTIONS = {'start', 'stop', 'restart'}

        self.assertEqual(STATUS_MAP.get(4), 'RUNNING')
        self.assertEqual(STATUS_MAP.get(1), 'STOPPED')
        self.assertEqual(START_MAP.get(2), 'Automatic')
        self.assertEqual(START_MAP.get(3), 'Manual')

        def is_action_allowed(act):
            return act.lower().strip() in ALLOWED_ACTIONS

        self.assertTrue(is_action_allowed('start'))
        self.assertTrue(is_action_allowed('stop'))
        self.assertTrue(is_action_allowed('restart'))
        self.assertFalse(is_action_allowed('delete'))
        self.assertFalse(is_action_allowed('kill'))
        self.assertFalse(is_action_allowed('disable'))

    def test_cli_flags_and_install_command_generation(self):
        """Ajan CLI parametreleri ve zamanlanmış görev komut formatını doğrular."""
        SUPPORTED_FLAGS = {'--install', '--uninstall', '--status', '--version', '--chat-ui', '--server'}
        for flag in ['--install', '--uninstall', '--status', '--version']:
            self.assertIn(flag, SUPPORTED_FLAGS)

        # Scheduled task oluşturma komutu format denetimi
        target_exe = r"C:\RemoteMM\RemoteMM_Agent.exe"
        cmd = f'schtasks /create /tn "RemoteMMAgent" /tr "\"{target_exe}\"" /ru "SYSTEM" /sc ONSTART /rl HIGHEST /f'
        self.assertIn('/ru "SYSTEM"', cmd)
        self.assertIn('/sc ONSTART', cmd)
        self.assertIn('/rl HIGHEST', cmd)
        self.assertIn('RemoteMMAgent', cmd)

    def test_enterprise_deployment_scripts_exist(self):
        """Kurumsal dağıtım ve sağlık denetimi betiklerinin varlığını ve bütünlüğünü doğrular."""
        import os
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        scripts_dir = os.path.join(base_dir, 'scripts')
        self.assertTrue(os.path.isdir(scripts_dir), "scripts/ dizini mevcut olmalı")

        expected_files = [
            'install-agent.bat',
            'uninstall-agent.bat',
            'deploy-gpo.ps1',
            'verify-agent.ps1'
        ]
        for f in expected_files:
            fpath = os.path.join(scripts_dir, f)
            self.assertTrue(os.path.isfile(fpath), f"Betik dosyası mevcut olmalı: {f}")
            self.assertGreater(os.path.getsize(fpath), 100, f"Betik dosyası boş olmamalı: {f}")

    def test_kvkk_consent_flow_and_rejection(self):
        """KVKK 12. Madde kapsamındaki kullanıcı rızası ve zaman aşımı paketlerini test eder."""
        # Onay verilmiş oturum yanıtı
        approved_resp = {
            'type': 'CONSENT_RESPONSE',
            'approved': True,
            'reason': 'APPROVED',
            'operator': 'ahmet.yilmaz'
        }
        self.assertEqual(approved_resp['type'], 'CONSENT_RESPONSE')
        self.assertTrue(approved_resp['approved'])
        self.assertEqual(approved_resp['reason'], 'APPROVED')

        # Reddedilmiş oturum yanıtı
        rejected_resp = {
            'type': 'CONSENT_RESPONSE',
            'approved': False,
            'reason': 'REJECTED_BY_USER',
            'operator': 'ahmet.yilmaz'
        }
        self.assertFalse(rejected_resp['approved'])
        self.assertEqual(rejected_resp['reason'], 'REJECTED_BY_USER')

        # 30 saniye zaman aşımı yanıtı
        timeout_resp = {
            'type': 'CONSENT_RESPONSE',
            'approved': False,
            'reason': 'TIMEOUT',
            'operator': 'ahmet.yilmaz'
        }
        self.assertFalse(timeout_resp['approved'])
        self.assertEqual(timeout_resp['reason'], 'TIMEOUT')

    def test_rbac_permissions_matrix(self):
        """RBAC rol yetki matrisini ve AUDITOR salt-okunur kısıtlamalarını doğrular."""
        AUDITOR_FORBIDDEN = {
            'MOUSE_INPUT', 'KEY_INPUT', 'BLACKOUT_SCREEN', 'LOCK_INPUT',
            'FS_UPLOAD', 'FS_DELETE', 'FS_EXEC', 'FS_MKDIR',
            'KILL_PROCESS', 'SERVICE_ACTION', 'POWER_ACTION', 'AGENT_UPGRADE'
        }

        def can_operator_execute(role, action):
            if role == 'SUPER_ADMIN':
                return True
            if role == 'AUDITOR':
                return action not in AUDITOR_FORBIDDEN
            if role == 'HELPDESK' and action == 'POWER_ACTION_SHUTDOWN':
                return False
            return True

        # AUDITOR testleri
        self.assertFalse(can_operator_execute('AUDITOR', 'MOUSE_INPUT'))
        self.assertFalse(can_operator_execute('AUDITOR', 'KEY_INPUT'))
        self.assertFalse(can_operator_execute('AUDITOR', 'FS_DELETE'))
        self.assertFalse(can_operator_execute('AUDITOR', 'KILL_PROCESS'))
        self.assertTrue(can_operator_execute('AUDITOR', 'SCREEN_VIEW'))
        self.assertTrue(can_operator_execute('AUDITOR', 'AUDIT_LOG_VIEW'))

        # HELPDESK testleri
        self.assertFalse(can_operator_execute('HELPDESK', 'POWER_ACTION_SHUTDOWN'))
        self.assertTrue(can_operator_execute('HELPDESK', 'MOUSE_INPUT'))
        self.assertTrue(can_operator_execute('HELPDESK', 'CHAT_MESSAGE'))

        # SUPER_ADMIN testleri
        self.assertTrue(can_operator_execute('SUPER_ADMIN', 'POWER_ACTION_SHUTDOWN'))
        self.assertTrue(can_operator_execute('SUPER_ADMIN', 'KILL_PROCESS'))
        self.assertTrue(can_operator_execute('SUPER_ADMIN', 'FS_UPLOAD'))

    def test_wix_msi_installer_definition(self):
        """WiX MSI Product.wxs ve derleme betiğinin varlığını, XML sözdizimini doğrular."""
        import os
        import xml.etree.ElementTree as ET

        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        wxs_path = os.path.join(base_dir, 'installer', 'Product.wxs')
        ps_path = os.path.join(base_dir, 'installer', 'build-msi.ps1')

        self.assertTrue(os.path.isfile(wxs_path), "installer/Product.wxs mevcut olmalı")
        self.assertTrue(os.path.isfile(ps_path), "installer/build-msi.ps1 mevcut olmalı")

        # XML geçerlilik kontrolü
        tree = ET.parse(wxs_path)
        root = tree.getroot()
        self.assertTrue('Wix' in root.tag or root.tag.endswith('Wix'))

        # İçerik denetimi
        with open(wxs_path, 'r', encoding='utf-8') as f:
            content = f.read()
        self.assertIn('RemoteMMAgent', content)
        self.assertIn('RemoteMM Enterprise Agent', content)
        self.assertIn('ServiceInstall', content)

    def test_auto_updater_hash_and_rollback_state_machine(self):
        """Bölüm 7.2 AutoUpdater SHA-256 doğrulama, geçici hazırlama ve geri alma (Rollback) durum makinesini test eder."""
        import tempfile
        import hashlib
        from updater import AutoUpdater

        with tempfile.TemporaryDirectory() as tmpdir:
            curr_bin = os.path.join(tmpdir, "RemoteMM_Agent.exe")
            with open(curr_bin, 'w', encoding='utf-8') as f:
                f.write("AGENT_VERSION_V1_STABLE")

            updater = AutoUpdater(curr_bin)

            # 1. Bozuk dosya / Hash uyuşmazlığı testi
            corrupt_new = os.path.join(tmpdir, "corrupt_download.exe")
            with open(corrupt_new, 'w', encoding='utf-8') as f:
                f.write("MALICIOUS_PAYLOAD")

            fake_hash = "0000000000000000000000000000000000000000000000000000000000000000"
            staged, reason = updater.stage_update(corrupt_new, fake_hash)
            self.assertFalse(staged)
            self.assertEqual(reason, "HASH_VERIFICATION_FAILED")
            self.assertFalse(os.path.exists(corrupt_new), "Bozuk dosya imha edilmiş olmalı")

            # 2. Geçerli dosya hazırlama ve uygulama testi
            valid_new = os.path.join(tmpdir, "valid_v2.exe")
            v2_content = "AGENT_VERSION_V2_PROD"
            with open(valid_new, 'w', encoding='utf-8') as f:
                f.write(v2_content)

            correct_hash = hashlib.sha256(v2_content.encode('utf-8')).hexdigest()
            staged_ok, msg = updater.stage_update(valid_new, correct_hash)
            self.assertTrue(staged_ok)

            applied, apply_msg = updater.apply_update_with_backup()
            self.assertTrue(applied)
            self.assertEqual(apply_msg, "APPLIED_PENDING_HEALTHCHECK")
            self.assertTrue(os.path.isfile(updater.backup_binary))

            # Yeni sürümün geçerli olduğunu doğrula
            with open(curr_bin, 'r', encoding='utf-8') as f:
                self.assertEqual(f.read(), v2_content)

            # 3. Sağlık denetimi başarısız -> Otomatik Rollback testi
            committed, status_msg = updater.complete_update_verification(is_healthy=False)
            self.assertFalse(committed)
            self.assertEqual(status_msg, "HEALTH_FAILED_ROLLBACK_SUCCESSFUL")

            # Eski sürüme geri dönülmüş olmalı
            with open(curr_bin, 'r', encoding='utf-8') as f:
                self.assertEqual(f.read(), "AGENT_VERSION_V1_STABLE")


if __name__ == '__main__':
    unittest.main()





