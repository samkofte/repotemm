import os
import sys
import unittest

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'agent'))
import system_manager

class TestSystemManager(unittest.TestCase):
    def test_native_process_enumeration(self):
        """Bölüm 6.1: Saf Win32 API ile süreç listeleme ve hafıza kullanımını test eder."""
        procs = system_manager.enum_processes_native(limit=25)
        self.assertGreater(len(procs), 0)
        first = procs[0]
        self.assertIn('Id', first)
        self.assertIn('ProcessName', first)
        self.assertIn('WorkingSet64', first)
        self.assertIn('User', first)
        self.assertIn('isProtected', first)

        # PID 4 (System) korumalı olmalı
        system_proc = next((p for p in procs if p['Id'] == 4), None)
        if system_proc:
            self.assertTrue(system_proc['isProtected'])

    def test_kernel_critical_process_kill_protection(self):
        """Bölüm 6.1: Çekirdek kritik süreçlerinin (System, csrss, lsass) sonlandırılmasının engellenmesini test eder."""
        self.assertTrue(system_manager.is_process_protected(0, 'System Idle Process'))
        self.assertTrue(system_manager.is_process_protected(4, 'System'))
        self.assertTrue(system_manager.is_process_protected(os.getpid(), 'python.exe'))
        self.assertTrue(system_manager.is_process_protected(99999, 'csrss.exe'))
        self.assertTrue(system_manager.is_process_protected(99998, 'lsass.exe'))
        self.assertTrue(system_manager.is_process_protected(99997, 'services.exe'))
        self.assertTrue(system_manager.is_process_protected(99996, 'RemoteMM_Agent.exe'))

        # Sıradan süreçler korunmaz
        self.assertFalse(system_manager.is_process_protected(99995, 'notepad.exe'))
        self.assertFalse(system_manager.is_process_protected(99994, 'calc.exe'))

        # PID 4 sonlandırma denemesi ACCESS_DENIED dönmeli
        ok, reason = system_manager.terminate_process_native(4)
        self.assertFalse(ok)
        self.assertEqual(reason, "ACCESS_DENIED_CRITICAL_PROCESS")

    def test_power_action_whitelist_and_dry_run(self):
        """Bölüm 6.1: İzinli güç yönetimi aksiyonlarının doğrulanmasını test eder."""
        # Geçersiz komut reddedilmelidir
        ok, reason = system_manager.execute_power_action_native("format_c")
        self.assertFalse(ok)
        self.assertIn("INVALID_ACTION", reason)

        # Abort eylemi (varsa mevcut shutdown sayacını iptal eder, güvenlidir)
        ok, reason = system_manager.execute_power_action_native("abort")
        # Abort geçerli bir fonksiyondur (aktif shutdown yoksa hata dönebilir veya success döner)
        self.assertTrue("SUCCESS" in reason or "ABORT_FAILED" in reason)

if __name__ == '__main__':
    unittest.main()
