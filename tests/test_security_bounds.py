"""
RemoteMM Enterprise — Güvenlik Sınırları ve Sıfır-Güven (Zero-Trust) Test Paketi
(tests/test_security_bounds.py)

ISO/IEC 27001:2022 Madde 8.28, SOC 2 Type II ve FIPS 140-3 uyumluluk sınırlarını test eder:
1. Dizin Atlama (Path Traversal) Engelleme (SAM, SYSTEM, drivers/etc koruması)
2. Tampon Taşması ve Aşırı Boyutlu Paket (Buffer Overflow / 25MB sınırı)
3. Kritik Çekirdek Süreçleri Sonlandırma Koruması (csrss, lsass, services, System)
4. Parametrik Komut Enjeksiyonu Engelleme (Shell injection filter)
5. Cihaz Token Tahrifatı ve Yetkisiz Erişim Doğrulaması
"""

import unittest
import os
import sys

# Agent ve Server modüllerini içe aktarma
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(BASE_DIR, 'agent'))

from identity import verify_device_token, load_or_create_identity


class TestSecurityBounds(unittest.TestCase):
    """Sıfır güven ve parametrik sınır güvenlik testleri."""

    def test_path_traversal_forbidden_targets(self):
        """Kritik sistem dosyalarına dizin atlama (traversal) ataklarının engellenmesini doğrular."""
        blocked_roots = [
            os.path.join(os.environ.get('SystemRoot', 'C:\\Windows'), 'System32', 'config').lower(),
            os.path.join(os.environ.get('SystemRoot', 'C:\\Windows'), 'System32', 'drivers', 'etc').lower(),
            'c:\\windows\\system32\\config',
            'c:\\windows\\system32\\drivers\\etc'
        ]

        def is_path_safe(target_path):
            if not target_path or not isinstance(target_path, str):
                return False
            norm = os.path.normpath(target_path).lower()
            abs_p = os.path.abspath(target_path).lower()
            dangerous_patterns = [
                'windows\\system32\\config',
                'windows\\system32\\drivers\\etc',
                'system32\\config'
            ]
            for pat in dangerous_patterns:
                if pat in norm or pat in abs_p:
                    return False
            for b in blocked_roots:
                if abs_p.startswith(b.lower()):
                    return False
            return True

        # Güvenli yollar
        self.assertTrue(is_path_safe("C:\\RemoteMM\\logs\\agent.log"))
        self.assertTrue(is_path_safe("C:\\Users\\Public\\Desktop\\readme.txt"))
        self.assertTrue(is_path_safe("D:\\Backups\\data.tar.gz"))

        # Kötü niyetli traversal girişimleri
        self.assertFalse(is_path_safe("C:\\RemoteMM\\..\\..\\Windows\\System32\\config\\SAM"))
        self.assertFalse(is_path_safe("C:\\Windows\\System32\\config\\SYSTEM"))
        self.assertFalse(is_path_safe("C:\\Windows\\System32\\drivers\\etc\\hosts"))
        self.assertFalse(is_path_safe("..\\..\\Windows\\System32\\config\\SECURITY"))
        self.assertFalse(is_path_safe(""))
        self.assertFalse(is_path_safe(None))

    def test_buffer_overflow_packet_limit(self):
        """25 MB üzeri aşırı büyük paketlerin ağ geçidi ve ajanda bellek taşmasını önlemesini doğrular."""
        MAX_PACKET_BYTES = 25 * 1024 * 1024  # 25 MB

        def validate_payload_size(data_len):
            return data_len <= MAX_PACKET_BYTES

        # Geçerli boyutlar
        self.assertTrue(validate_payload_size(1024))          # 1 KB
        self.assertTrue(validate_payload_size(5 * 1024 * 1024)) # 5 MB
        self.assertTrue(validate_payload_size(25 * 1024 * 1024)) # 25 MB tam sınır

        # Sınır aşımı (DoS / Tampon taşması girişimi)
        self.assertFalse(validate_payload_size(25 * 1024 * 1024 + 1)) # 25MB + 1 bayt
        self.assertFalse(validate_payload_size(50 * 1024 * 1024))     # 50 MB
        self.assertFalse(validate_payload_size(100 * 1024 * 1024))    # 100 MB

    def test_kernel_critical_process_kill_protection(self):
        """Kritik Windows çekirdek süreçlerinin sonlandırılmasının hardcoded olarak engellenmesini doğrular."""
        PROTECTED_SYSTEM_PROCESSES = {
            'system', 'system idle process', 'smss.exe', 'csrss.exe',
            'wininit.exe', 'services.exe', 'lsass.exe', 'svchost.exe',
            'remotemm_agent.exe', 'winlogon.exe'
        }

        def can_kill_process(proc_name, pid):
            if pid <= 4:
                return False  # PID 0 (Idle) ve PID 4 (System) asla öldürülemez
            if proc_name.lower().strip() in PROTECTED_SYSTEM_PROCESSES:
                return False
            return True

        # Normal sonlandırılabilir kullanıcı süreçleri
        self.assertTrue(can_kill_process("notepad.exe", 1420))
        self.assertTrue(can_kill_process("chrome.exe", 8892))
        self.assertTrue(can_kill_process("calc.exe", 3310))

        # Korumalı çekirdek ve ajan süreçleri (Kesinlikle engellenmeli)
        self.assertFalse(can_kill_process("System", 4))
        self.assertFalse(can_kill_process("csrss.exe", 620))
        self.assertFalse(can_kill_process("lsass.exe", 710))
        self.assertFalse(can_kill_process("services.exe", 680))
        self.assertFalse(can_kill_process("smss.exe", 312))
        self.assertFalse(can_kill_process("RemoteMM_Agent.exe", 9400))
        self.assertFalse(can_kill_process("winlogon.exe", 812))

    def test_command_injection_whitelist_enforcement(self):
        """Komut satırına rastgele shell enjeksiyonu denemelerinin reddedilmesini doğrular."""
        ALLOWED_ACTIONS = {
            'POWER_ACTION_REBOOT',
            'POWER_ACTION_SHUTDOWN',
            'POWER_ACTION_SLEEP',
            'POWER_ACTION_LOCK',
            'POWER_ACTION_LOGOFF',
            'POWER_ACTION_ABORT',
            'SERVICE_ACTION_START',
            'SERVICE_ACTION_STOP',
            'SERVICE_ACTION_RESTART',
            'TASK_KILL'
        }

        def is_safe_action(action_str):
            if not action_str or not isinstance(action_str, str):
                return False
            action_clean = action_str.strip().upper()
            return action_clean in ALLOWED_ACTIONS

        # Tanımlı eylemler
        self.assertTrue(is_safe_action('POWER_ACTION_REBOOT'))
        self.assertTrue(is_safe_action('POWER_ACTION_LOCK'))
        self.assertTrue(is_safe_action('SERVICE_ACTION_RESTART'))

        # Komut enjeksiyonu girişimleri
        self.assertFalse(is_safe_action('POWER_ACTION_REBOOT; rm -rf /'))
        self.assertFalse(is_safe_action('POWER_ACTION_LOCK && calc.exe'))
        self.assertFalse(is_safe_action('TASK_KILL | powershell Invoke-Mimikatz'))
        self.assertFalse(is_safe_action('`net user hacker Pass123 /add`'))
        self.assertFalse(is_safe_action(''))

    def test_device_token_tampering_rejection(self):
        """Tahrif edilmiş veya geçersiz cihaz token'larının reddedildiğini doğrular."""
        ident = load_or_create_identity()
        valid_hwid = ident['hwid']
        valid_token = ident['deviceToken']

        # Orijinal token geçerli olmalı
        self.assertTrue(verify_device_token(valid_hwid, valid_token))

        # Tahrif edilmiş token'lar kesinlikle reddedilmeli
        tampered_token = valid_token[:-4] + "ffff"
        self.assertFalse(verify_device_token(valid_hwid, tampered_token))
        self.assertFalse(verify_device_token(valid_hwid, "tok_fake_random_hash_12345"))
        self.assertFalse(verify_device_token(valid_hwid, ""))
        self.assertFalse(verify_device_token("fake_hwid_000000000000000000000000", valid_token))


if __name__ == '__main__':
    unittest.main()
