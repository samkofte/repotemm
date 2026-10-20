"""
Unit Tests for RemoteMM Enterprise AutoUpdater & Rollback Workflow
-------------------------------------------------------------------
Verifies Section 7.2 of ENTERPRISE_ENGINEERING_BIBLE.md:
- SHA-256 calculation and verification
- Tamper detection and immediate destruction of corrupt files
- Backup creation (.bak) before binary replacement
- Automatic rollback on healthcheck failure
- Complete upgrade workflow orchestration
"""

import unittest
import os
import shutil
import tempfile
import hashlib
from unittest.mock import patch, MagicMock

from agent.updater import AutoUpdater
from agent.auto_updater_daemon import AutoUpdateDaemon


class TestUpdaterWorkflow(unittest.TestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="rmm_updater_test_")
        self.current_exe = os.path.join(self.test_dir, "RemoteMM_Agent.exe")
        with open(self.current_exe, "wb") as f:
            f.write(b"ORIGINAL_BINARY_v4.2.0")
        self.updater = AutoUpdater(self.current_exe)

    def tearDown(self):
        if os.path.isdir(self.test_dir):
            try:
                shutil.rmtree(self.test_dir)
            except Exception:
                pass

    def test_sha256_calculation_and_verification(self):
        """Tests SHA-256 calculation and exact hash match verification."""
        computed = self.updater.calculate_sha256(self.current_exe)
        expected = hashlib.sha256(b"ORIGINAL_BINARY_v4.2.0").hexdigest()

        self.assertEqual(computed, expected)
        self.assertTrue(self.updater.verify_hash(self.current_exe, expected.upper()))
        self.assertFalse(self.updater.verify_hash(self.current_exe, "0000000000000000000000000000000000000000000000000000000000000000"))

    def test_stage_update_with_tamper_destruction(self):
        """Tests that a corrupted or mismatched binary is immediately deleted from disk."""
        tampered_file = os.path.join(self.test_dir, "corrupt_download.tmp")
        with open(tampered_file, "wb") as f:
            f.write(b"MALICIOUS_PAYLOAD_OR_CORRUPT_BYTES")

        fake_hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"

        # Staging with wrong hash must fail and delete the file immediately
        ok, msg = self.updater.stage_update(tampered_file, fake_hash)
        self.assertFalse(ok)
        self.assertEqual(msg, "HASH_VERIFICATION_FAILED")
        self.assertFalse(os.path.exists(tampered_file), "Corrupted file must be destroyed immediately from disk")

    def test_backup_and_apply_update(self):
        """Tests that applying staged update backs up current binary and swaps atomically."""
        new_source = os.path.join(self.test_dir, "valid_new.exe")
        new_content = b"NEW_ENTERPRISE_BINARY_v5.0.0"
        with open(new_source, "wb") as f:
            f.write(new_content)

        valid_hash = hashlib.sha256(new_content).hexdigest()
        stage_ok, stage_msg = self.updater.stage_update(new_source, valid_hash)
        self.assertTrue(stage_ok)

        # Apply update
        apply_ok, apply_msg = self.updater.apply_update_with_backup()
        self.assertTrue(apply_ok)
        self.assertEqual(apply_msg, "APPLIED_PENDING_HEALTHCHECK")

        # Verify backup exists and has original content
        self.assertTrue(os.path.isfile(self.updater.backup_binary))
        with open(self.updater.backup_binary, "rb") as f:
            self.assertEqual(f.read(), b"ORIGINAL_BINARY_v4.2.0")

        # Verify current binary now has new content
        with open(self.current_exe, "rb") as f:
            self.assertEqual(f.read(), new_content)

    def test_rollback_restore_state(self):
        """Tests rollback restores previous binary from .bak."""
        # Setup backup binary
        with open(self.updater.backup_binary, "wb") as f:
            f.write(b"PREVIOUS_STABLE_BINARY")

        # Overwrite current with broken binary
        with open(self.current_exe, "wb") as f:
            f.write(b"BROKEN_CRASHING_BINARY")

        # Rollback
        roll_ok, roll_msg = self.updater.rollback()
        self.assertTrue(roll_ok)
        self.assertEqual(roll_msg, "ROLLBACK_SUCCESSFUL")

        with open(self.current_exe, "rb") as f:
            self.assertEqual(f.read(), b"PREVIOUS_STABLE_BINARY")

    def test_complete_update_verification(self):
        """Tests complete_update_verification cleans backup on success and rolls back on failure."""
        with open(self.updater.backup_binary, "wb") as f:
            f.write(b"BACKUP_CONTENT")

        # 1. Healthcheck success: commit and delete backup
        res_ok, msg = self.updater.complete_update_verification(is_healthy=True)
        self.assertTrue(res_ok)
        self.assertEqual(msg, "UPDATE_COMMITTED")
        self.assertFalse(os.path.exists(self.updater.backup_binary))

        # 2. Healthcheck failure: rollback
        with open(self.updater.backup_binary, "wb") as f:
            f.write(b"BACKUP_CONTENT_2")
        res_fail, msg_fail = self.updater.complete_update_verification(is_healthy=False)
        self.assertFalse(res_fail)
        self.assertIn("HEALTH_FAILED", msg_fail)

    def test_execute_upgrade_workflow_dry_run(self):
        """Tests execute_upgrade_workflow orchestration with mocked download."""
        dummy_content = b"REMOTE_DOWNLOADED_BINARY_CONTENT"
        dummy_hash = hashlib.sha256(dummy_content).hexdigest()

        download_dest = os.path.join(self.test_dir, "downloaded.tmp")
        with open(download_dest, "wb") as f:
            f.write(dummy_content)

        with patch.object(self.updater, 'download_from_url', return_value=(True, download_dest)):
            res = self.updater.execute_upgrade_workflow(
                url="http://test-server/binary.exe",
                expected_sha256=dummy_hash,
                target_version="v5.1.0",
                dry_run=True
            )
            self.assertTrue(res['success'])
            self.assertEqual(res['stage'], 'DRY_RUN')
            self.assertEqual(res['targetVersion'], 'v5.1.0')

    def test_auto_update_daemon_discovery_and_report(self):
        """Tests AutoUpdateDaemon discovery of new version and telemetry reporting."""
        daemon = AutoUpdateDaemon(
            server_url="http://mock-gw:3001",
            current_version="5.0.0",
            hwid="hwid_test_auto_update_123",
            current_exe_path=self.current_exe
        )

        # Mock discovery response
        mock_response = MagicMock()
        mock_response.read.return_value = (
            b'{"success": true, "updateAvailable": true, "release": {"version": "5.2.0", "sha256": "hash123", "downloadUrl": "/dl"}}'
        )
        mock_response.__enter__.return_value = mock_response

        with patch("urllib.request.urlopen", return_value=mock_response):
            rel = daemon.check_for_updates()
            self.assertIsNotNone(rel)
            self.assertEqual(rel["version"], "5.2.0")

        # Mock telemetry report response
        mock_report_resp = MagicMock()
        mock_report_resp.status = 200
        mock_report_resp.__enter__.return_value = mock_report_resp

        with patch("urllib.request.urlopen", return_value=mock_report_resp):
            rep_ok = daemon.send_update_report(status="SUCCESS", to_version="5.2.0")
            self.assertTrue(rep_ok)

    def test_auto_update_daemon_post_update_health_verification(self):
        """Tests that verify_post_update_health confirms startup and cleans backup file."""
        daemon = AutoUpdateDaemon(
            server_url="http://mock-gw:3001",
            current_version="5.2.0",
            hwid="hwid_test_health",
            current_exe_path=self.current_exe
        )

        # Create dummy backup file indicating update just occurred
        with open(daemon.updater.backup_binary, "wb") as f:
            f.write(b"PREVIOUS_VERSION_BACKUP")

        with patch.object(daemon, "send_update_report", return_value=True) as mock_report:
            verified = daemon.verify_post_update_health()
            self.assertTrue(verified)
            mock_report.assert_called_once_with(
                status="SUCCESS",
                to_version="5.2.0",
                error_message="Booted healthy into updated binary"
            )
            self.assertFalse(os.path.exists(daemon.updater.backup_binary))


if __name__ == '__main__':
    unittest.main()
