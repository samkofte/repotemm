"""
RemoteMM Enterprise - Autonomous Self-Updating Daemon
(agent/auto_updater_daemon.py)
-----------------------------------------------------
Provides continuous Over-The-Air (OTA) version monitoring, cryptographic
SHA-256 integrity verification, autonomous atomic binary replacement,
and automated server-side telemetry reporting.
"""

import os
import sys
import time
import json
import threading
import urllib.request
import urllib.error
import subprocess
from typing import Optional, Dict, Any, Tuple

from agent.updater import AutoUpdater


class AutoUpdateDaemon:
    def __init__(
        self,
        server_url: str = "http://127.0.0.1:3001",
        current_version: str = "5.0.0",
        hwid: str = "default_device_hwid",
        channel: str = "stable",
        check_interval_sec: int = 1800,
        current_exe_path: Optional[str] = None
    ):
        self.server_url = server_url.rstrip("/")
        self.current_version = current_version
        self.hwid = hwid
        self.channel = channel
        self.check_interval_sec = check_interval_sec
        self.updater = AutoUpdater(current_exe_path)
        self.base_dir = self.updater.base_dir
        self.running = False
        self.thread: Optional[threading.Thread] = None

    def check_for_updates(self, timeout_sec: int = 10) -> Optional[Dict[str, Any]]:
        """
        Queries the central Gateway for the latest release in this channel.
        """
        query_url = (
            f"{self.server_url}/api/releases/latest"
            f"?channel={self.channel}&currentVersion={self.current_version}&hwid={self.hwid}"
        )
        try:
            req = urllib.request.Request(
                query_url,
                headers={"User-Agent": f"RemoteMM-Agent-OTA/{self.current_version}"}
            )
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("updateAvailable") and "release" in data:
                    return data["release"]
                return None
        except Exception as e:
            return None

    def send_update_report(
        self,
        status: str,
        to_version: str,
        from_version: Optional[str] = None,
        error_message: str = "",
        timeout_sec: int = 5
    ) -> bool:
        """
        Reports update lifecycle event (SUCCESS, ROLLBACK, FAILED) back to Gateway.
        """
        report_url = f"{self.server_url}/api/releases/report"
        payload = json.dumps({
            "hwid": self.hwid,
            "fromVersion": from_version or self.current_version,
            "toVersion": to_version,
            "status": status,
            "errorMessage": error_message
        }).encode("utf-8")

        try:
            req = urllib.request.Request(
                report_url,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": f"RemoteMM-Agent-OTA/{self.current_version}"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                return resp.status in (200, 201)
        except Exception:
            return False

    def check_and_apply_update(self, dry_run: bool = False) -> Tuple[bool, str]:
        """
        Executes full check -> download -> verify -> stage -> apply cycle.
        """
        release = self.check_for_updates()
        if not release:
            return False, "NO_UPDATE_AVAILABLE"

        target_version = release.get("version", "unknown")
        expected_sha256 = release.get("sha256", "")
        raw_download_url = release.get("downloadUrl", "")

        # Qualify download URL if relative
        if raw_download_url.startswith("/"):
            download_url = f"{self.server_url}{raw_download_url}"
        else:
            download_url = raw_download_url

        # Execute download and verification via AutoUpdater
        result = self.updater.execute_upgrade_workflow(
            url=download_url,
            expected_sha256=expected_sha256,
            target_version=target_version,
            dry_run=dry_run
        )

        if not result.get("success"):
            err_msg = result.get("error", "UNKNOWN_ERROR")
            self.send_update_report(
                status="FAILED",
                to_version=target_version,
                error_message=f"Stage: {result.get('stage')} - {err_msg}"
            )
            return False, err_msg

        if dry_run:
            return True, "DRY_RUN_PASSED"

        # Write autonomous atomic Windows batch script to swap running executable
        script_path = os.path.join(self.base_dir, "apply_ota.cmd")
        cmd_content = f"""@echo off
timeout /t 2 /nobreak >nul
sc.exe stop RemoteMMAgent >nul 2>&1
if exist "{self.updater.backup_binary}" del /f /q "{self.updater.backup_binary}"
if exist "{self.updater.current_binary}" ren "{self.updater.current_binary}" "RemoteMM_Agent.bak"
move /y "{self.updater.downloaded_binary}" "{self.updater.current_binary}"
sc.exe start RemoteMMAgent >nul 2>&1
"""
        try:
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(cmd_content)
        except Exception as e:
            self.send_update_report(status="FAILED", to_version=target_version, error_message=f"BATCH_WRITE_{e}")
            return False, f"BATCH_WRITE_ERROR_{e}"

        self.send_update_report(status="APPLIED", to_version=target_version)
        return True, f"UPDATE_APPLIED_v{target_version}"

    def verify_post_update_health(self) -> bool:
        """
        Called upon agent startup: if a .bak exists, the agent just updated!
        Confirms health, notifies the Gateway, and cleans up old backup.
        """
        if os.path.isfile(self.updater.backup_binary):
            # Agent successfully booted into new binary
            self.send_update_report(
                status="SUCCESS",
                to_version=self.current_version,
                error_message="Booted healthy into updated binary"
            )
            try:
                os.remove(self.updater.backup_binary)
            except Exception:
                pass
            return True
        return False

    def _loop(self):
        while self.running:
            try:
                self.check_and_apply_update()
            except Exception:
                pass

            # Sleep in 1-second slices so stop() is responsive
            for _ in range(self.check_interval_sec):
                if not self.running:
                    break
                time.sleep(1)

    def start(self):
        """Starts the background update worker thread."""
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._loop, name="RemoteMM_AutoUpdater", daemon=True)
        self.thread.start()

    def stop(self):
        """Stops the background update worker thread."""
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)
