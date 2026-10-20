"""
Unit Tests for RemoteMM Enterprise Win32 Session Worker Supervisor & Watchdog
-----------------------------------------------------------------------------
Verifies Session 0 isolation supervisor:
- Active console session discovery & fallback
- Worker process tracking & exit code evaluation
- Session switch transition handling
- Anti-crash burst throttling & cooldown
- Safe cleanup of handles and state
"""

import unittest
import time
import subprocess
import sys
from unittest.mock import MagicMock, patch

from agent.session_supervisor import (
    SessionWorkerSupervisor,
    WorkerProcessInfo,
    WAIT_TIMEOUT,
    WAIT_OBJECT_0,
    STILL_ACTIVE
)


class TestSessionSupervisor(unittest.TestCase):

    def test_worker_process_info_popen_lifecycle(self):
        """Tests WorkerProcessInfo tracking a real dummy subprocess."""
        # Launch lightweight python one-liner
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(0.2)"])
        info = WorkerProcessInfo(
            pid=p.pid,
            session_id=1,
            desktop="TestDesktop",
            popen_obj=p
        )

        self.assertTrue(info.is_alive())
        self.assertEqual(info.status, "RUNNING")
        self.assertEqual(info.session_id, 1)

        # Wait for termination
        p.wait()
        self.assertFalse(info.is_alive())
        self.assertEqual(info.status, "STOPPED")
        self.assertEqual(info.exit_code, 0)

    def test_worker_process_info_terminate(self):
        """Tests graceful and forced termination via WorkerProcessInfo."""
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(10)"])
        info = WorkerProcessInfo(
            pid=p.pid,
            session_id=1,
            popen_obj=p
        )
        self.assertTrue(info.is_alive())
        res = info.terminate(timeout_sec=0.5)
        self.assertTrue(res)
        self.assertFalse(info.is_alive())
        self.assertEqual(info.status, "STOPPED")

    def test_burst_throttling_detection(self):
        """Tests sliding window crash burst detection logic."""
        supervisor = SessionWorkerSupervisor(
            max_restart_burst=3,
            burst_window_sec=5.0,
            cooldown_backoff_sec=2.0
        )

        now = 1000.0
        self.assertFalse(supervisor.is_burst_throttled(now))

        # Add 2 restarts within window
        supervisor.restart_history.extend([1001.0, 1002.0])
        self.assertFalse(supervisor.is_burst_throttled(now + 3.0))

        # Add 3rd restart -> reaches max_restart_burst (3)
        supervisor.restart_history.append(1003.0)
        self.assertTrue(supervisor.is_burst_throttled(now + 4.0))

        # Advance beyond burst window -> older timestamps discarded
        self.assertFalse(supervisor.is_burst_throttled(now + 10.0))

    def test_supervisor_initial_launch_step(self):
        """Tests supervisor successfully launching worker on initial step."""
        supervisor = SessionWorkerSupervisor(
            target_flag="--test",
            max_restart_burst=3,
            burst_window_sec=10.0
        )

        # Mock inject_worker_in_session to return a mock worker
        mock_worker = MagicMock()
        mock_worker.is_alive.return_value = True
        mock_worker.pid = 9999
        mock_worker.session_id = 1
        mock_worker.desktop = "WinSta0\\Default"
        mock_worker.status = "RUNNING"
        mock_worker.exit_code = None
        mock_worker.launch_time = time.time()

        with patch.object(supervisor, 'inject_worker_in_session', return_value=mock_worker) as mock_inject, \
             patch.object(supervisor, 'get_active_session_id', return_value=1):

            status = supervisor.step()
            mock_inject.assert_called_once_with(1)
            self.assertEqual(status['supervisorState'], "ACTIVE")
            self.assertEqual(status['totalRestarts'], 1)
            self.assertEqual(status['worker']['pid'], 9999)

    def test_supervisor_session_switch_handling(self):
        """Tests supervisor detecting active session switch and migrating worker."""
        supervisor = SessionWorkerSupervisor()
        supervisor.active_session_id = 1

        mock_worker = MagicMock()
        mock_worker.is_alive.return_value = True
        mock_worker.terminate.return_value = True
        supervisor.current_worker = mock_worker

        # Simulate active session switching from 1 to 2 (e.g., fast user switching)
        with patch.object(supervisor, 'get_active_session_id', return_value=2):
            status = supervisor.step()
            # Must terminate old worker
            mock_worker.terminate.assert_called_once()
            self.assertIsNone(supervisor.current_worker)
            self.assertEqual(supervisor.active_session_id, 2)
            self.assertEqual(status['supervisorState'], "SESSION_SWITCHING")

    def test_supervisor_backoff_on_repeated_crashes(self):
        """Tests supervisor entering cooldown backoff when crash limit is reached."""
        supervisor = SessionWorkerSupervisor(
            max_restart_burst=2,
            burst_window_sec=10.0,
            cooldown_backoff_sec=5.0
        )

        # Worker keeps dying immediately
        with patch.object(supervisor, 'inject_worker_in_session', return_value=None), \
             patch.object(supervisor, 'get_active_session_id', return_value=1):

            step1 = supervisor.step()
            self.assertEqual(step1['supervisorState'], "LAUNCH_FAILED")
            self.assertEqual(supervisor.consecutive_crashes, 1)

            step2 = supervisor.step()
            self.assertEqual(step2['supervisorState'], "BACKOFF_THROTTLED")
            self.assertTrue(step2['isThrottled'])

    def test_stop_supervisor_cleans_resources(self):
        """Tests stopping supervisor cleanly terminates worker."""
        supervisor = SessionWorkerSupervisor()
        mock_worker = MagicMock()
        mock_worker.terminate.return_value = True
        supervisor.current_worker = mock_worker

        supervisor.stop()
        mock_worker.terminate.assert_called_once()
        self.assertIsNone(supervisor.current_worker)
        self.assertEqual(supervisor.supervisor_state, "STOPPED")

    def test_worker_process_info_win32_handle_lifecycle(self):
        """Tests Win32 handle monitoring with WaitForSingleObject and exit code extraction."""
        fake_handle = 12345
        info = WorkerProcessInfo(
            pid=777,
            session_id=1,
            h_process=fake_handle,
            h_thread=67890,
            desktop="WinSta0\\Default"
        )

        with patch('agent.session_supervisor.kernel32') as mock_k32:
            # 1. Process still running (WAIT_TIMEOUT)
            mock_k32.WaitForSingleObject.return_value = WAIT_TIMEOUT
            self.assertTrue(info.is_alive())
            self.assertEqual(info.status, "RUNNING")

            # 2. Process terminated with exit code 0
            mock_k32.WaitForSingleObject.return_value = WAIT_OBJECT_0
            def fake_get_exit_code(handle, ptr):
                ptr._obj.value = 0
                return True
            mock_k32.GetExitCodeProcess.side_effect = fake_get_exit_code
            mock_k32.CloseHandle.return_value = True

            self.assertFalse(info.is_alive())
            self.assertEqual(info.status, "STOPPED")
            self.assertEqual(info.exit_code, 0)
            self.assertIsNone(info.h_process)
            self.assertIsNone(info.h_thread)

    def test_supervisor_loop_bounded_iterations(self):
        """Tests run_loop runs bounded number of iterations and stops cleanly."""
        supervisor = SessionWorkerSupervisor(poll_interval_sec=0.01)
        with patch.object(supervisor, 'step') as mock_step:
            supervisor.run_loop(max_iterations=3)
            self.assertEqual(mock_step.call_count, 3)
            self.assertEqual(supervisor.supervisor_state, "STOPPED")



if __name__ == '__main__':
    unittest.main()
