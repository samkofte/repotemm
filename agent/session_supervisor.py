"""
RemoteMM Enterprise - Win32 Session Worker Supervisor & Launch Watchdog
------------------------------------------------------------------------
Implements Section 5 of ENTERPRISE_ENGINEERING_BIBLE.md:
- Session 0 Isolation: SYSTEM service supervision of interactive worker
- Dynamic active console session discovery (WTSGetActiveConsoleSessionId)
- 3-tier token acquisition (WTSQueryUserToken -> Process Token Clone -> SYSTEM Token Clone)
- User session process injection via CreateProcessAsUserW targeting WinSta0\\Default
- Win32 process handle supervision with WaitForSingleObject & GetExitCodeProcess
- Crash-loop prevention with sliding-window burst detection & exponential cooldown
- Clean process handle management and graceful termination
"""

import sys
import os
import time
import ctypes
import ctypes.wintypes
import subprocess
import threading
from typing import Optional, Dict, Any, List

# Win32 Constants
TOKEN_ASSIGN_PRIMARY     = 0x0001
TOKEN_DUPLICATE          = 0x0002
TOKEN_IMPERSONATE        = 0x0004
TOKEN_QUERY              = 0x0008
TOKEN_QUERY_SOURCE       = 0x0010
TOKEN_ADJUST_PRIVILEGES  = 0x0020
TOKEN_ADJUST_GROUPS      = 0x0040
TOKEN_ADJUST_DEFAULT     = 0x0080
TOKEN_ADJUST_SESSIONID   = 0x0100
TOKEN_ALL_ACCESS         = 0x000F0000 | 0x01FF

SECURITY_IMPERSONATION   = 2
TOKEN_PRIMARY            = 1
TOKEN_SESSION_ID         = 12

CREATE_UNICODE_ENVIRONMENT = 0x00000400
CREATE_NO_WINDOW           = 0x08000000
NORMAL_PRIORITY_CLASS      = 0x00000020

WAIT_OBJECT_0            = 0x00000000
WAIT_TIMEOUT             = 0x00000102
WAIT_FAILED              = 0xFFFFFFFF
STILL_ACTIVE             = 259

PROCESS_TERMINATE        = 0x0001
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
SYNCHRONIZE              = 0x00100000
TH32CS_SNAPPROCESS       = 0x00000002

INVALID_HANDLE_VALUE     = ctypes.c_void_p(-1).value

# Setup Win32 DLL wrappers with safe fallback
is_windows = sys.platform == 'win32'

if is_windows:
    kernel32 = ctypes.windll.kernel32
    advapi32 = ctypes.windll.advapi32
    userenv  = ctypes.windll.userenv
    wtsapi32 = ctypes.windll.wtsapi32
    user32   = ctypes.windll.user32

    class STARTUPINFO(ctypes.Structure):
        _fields_ = [
            ('cb',              ctypes.c_ulong),
            ('lpReserved',      ctypes.c_wchar_p),
            ('lpDesktop',       ctypes.c_wchar_p),
            ('lpTitle',         ctypes.c_wchar_p),
            ('dwX',             ctypes.c_ulong), ('dwY', ctypes.c_ulong),
            ('dwXSize',         ctypes.c_ulong), ('dwYSize', ctypes.c_ulong),
            ('dwXCountChars',   ctypes.c_ulong), ('dwYCountChars', ctypes.c_ulong),
            ('dwFillAttribute', ctypes.c_ulong),
            ('dwFlags',         ctypes.c_ulong),
            ('wShowWindow',     ctypes.c_ushort),
            ('cbReserved2',     ctypes.c_ushort),
            ('lpReserved2',     ctypes.c_void_p),
            ('hStdInput',       ctypes.c_void_p),
            ('hStdOutput',      ctypes.c_void_p),
            ('hStdError',       ctypes.c_void_p),
        ]

    class PROCESS_INFORMATION(ctypes.Structure):
        _fields_ = [
            ('hProcess', ctypes.c_void_p),
            ('hThread', ctypes.c_void_p),
            ('dwProcessId', ctypes.c_ulong),
            ('dwThreadId', ctypes.c_ulong),
        ]

    class PROCESSENTRY32(ctypes.Structure):
        _fields_ = [
            ('dwSize', ctypes.wintypes.DWORD),
            ('cntUsage', ctypes.wintypes.DWORD),
            ('th32ProcessID', ctypes.wintypes.DWORD),
            ('th32DefaultHeapID', ctypes.c_void_p),
            ('th32ModuleID', ctypes.wintypes.DWORD),
            ('cntThreads', ctypes.wintypes.DWORD),
            ('th32ParentProcessID', ctypes.wintypes.DWORD),
            ('pcPriClassBase', ctypes.c_long),
            ('dwFlags', ctypes.wintypes.DWORD),
            ('szExeFile', ctypes.c_char * 260)
        ]

    # Setup argtypes / restypes
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    kernel32.GetCurrentProcessId.restype = ctypes.c_ulong
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle.restype = ctypes.c_bool
    kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    kernel32.WaitForSingleObject.restype = ctypes.c_ulong
    kernel32.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.wintypes.DWORD)]
    kernel32.GetExitCodeProcess.restype = ctypes.c_bool
    kernel32.TerminateProcess.argtypes = [ctypes.c_void_p, ctypes.c_uint]
    kernel32.TerminateProcess.restype = ctypes.c_bool

    advapi32.OpenProcessToken.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]
    advapi32.OpenProcessToken.restype = ctypes.c_int32
    advapi32.DuplicateTokenEx.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p,
        ctypes.c_int32, ctypes.c_int32, ctypes.POINTER(ctypes.c_void_p)
    ]
    advapi32.DuplicateTokenEx.restype = ctypes.c_int32
    advapi32.SetTokenInformation.argtypes = [ctypes.c_void_p, ctypes.c_int32, ctypes.c_void_p, ctypes.c_uint32]
    advapi32.SetTokenInformation.restype = ctypes.c_int32
    advapi32.CreateProcessAsUserW.argtypes = [
        ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_void_p,
        ctypes.c_bool, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_void_p
    ]
    advapi32.CreateProcessAsUserW.restype = ctypes.c_int32

    userenv.CreateEnvironmentBlock.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p, ctypes.c_bool]
    userenv.CreateEnvironmentBlock.restype = ctypes.c_bool
    userenv.DestroyEnvironmentBlock.argtypes = [ctypes.c_void_p]
    userenv.DestroyEnvironmentBlock.restype = ctypes.c_bool

    kernel32.WTSGetActiveConsoleSessionId.restype = ctypes.wintypes.DWORD
    wtsapi32.WTSQueryUserToken.argtypes = [ctypes.wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p)]
    wtsapi32.WTSQueryUserToken.restype = ctypes.c_bool
else:
    kernel32 = None
    advapi32 = None
    userenv = None
    wtsapi32 = None
    user32 = None


class WorkerProcessInfo:
    """Encapsulates tracked interactive session worker process."""
    def __init__(self, pid: int, session_id: int, h_process: Any = None, h_thread: Any = None,
                 desktop: str = "WinSta0\\Default", popen_obj: Optional[subprocess.Popen] = None):
        self.pid: int = pid
        self.session_id: int = session_id
        self.h_process: Any = h_process
        self.h_thread: Any = h_thread
        self.desktop: str = desktop
        self.popen_obj: Optional[subprocess.Popen] = popen_obj
        self.launch_time: float = time.time()
        self.exit_code: Optional[int] = None
        self.status: str = "RUNNING"

    def is_alive(self) -> bool:
        """Checks if worker process is still alive without blocking."""
        if self.status != "RUNNING":
            return False

        if self.popen_obj is not None:
            ret = self.popen_obj.poll()
            if ret is not None:
                self.exit_code = ret
                self.status = "STOPPED" if ret == 0 else "CRASHED"
                return False
            return True

        if self.h_process and is_windows:
            try:
                res = kernel32.WaitForSingleObject(self.h_process, 0)
                if res == WAIT_TIMEOUT:
                    return True
                
                # Process has terminated
                ec = ctypes.wintypes.DWORD()
                if kernel32.GetExitCodeProcess(self.h_process, ctypes.byref(ec)):
                    self.exit_code = ec.value
                else:
                    self.exit_code = -1

                self.status = "STOPPED" if self.exit_code == 0 else "CRASHED"
                self.cleanup_handles()
                return False
            except Exception:
                self.status = "CRASHED"
                return False

        return False

    def terminate(self, timeout_sec: float = 2.0) -> bool:
        """Politely requests or forcefully terminates worker process and cleans up."""
        if not self.is_alive() and self.status != "RUNNING":
            self.cleanup_handles()
            return True

        if self.popen_obj is not None:
            try:
                self.popen_obj.terminate()
                try:
                    self.popen_obj.wait(timeout=timeout_sec)
                except subprocess.TimeoutExpired:
                    self.popen_obj.kill()
                    self.popen_obj.wait(timeout=1.0)
                self.status = "STOPPED"
                self.exit_code = self.popen_obj.returncode
                return True
            except Exception:
                return False

        if self.h_process and is_windows:
            try:
                kernel32.TerminateProcess(self.h_process, 1)
                kernel32.WaitForSingleObject(self.h_process, int(timeout_sec * 1000))
                ec = ctypes.wintypes.DWORD()
                if kernel32.GetExitCodeProcess(self.h_process, ctypes.byref(ec)):
                    self.exit_code = ec.value
                self.status = "STOPPED"
                self.cleanup_handles()
                return True
            except Exception:
                self.cleanup_handles()
                return False

        self.status = "STOPPED"
        return True

    def cleanup_handles(self) -> None:
        """Closes open Win32 process and thread handles to prevent leaks."""
        if is_windows:
            if self.h_process:
                try:
                    kernel32.CloseHandle(self.h_process)
                except Exception:
                    pass
                self.h_process = None
            if self.h_thread:
                try:
                    kernel32.CloseHandle(self.h_thread)
                except Exception:
                    pass
                self.h_thread = None


class SessionWorkerSupervisor:
    """
    Supervises the interactive worker process from Session 0 (or standalone service).
    Enforces automatic respawn, session switch detection, and crash-burst throttling.
    """

    def __init__(self, target_flag: str = "--session-worker", agent_path: Optional[str] = None,
                 max_restart_burst: int = 5, burst_window_sec: float = 30.0,
                 cooldown_backoff_sec: float = 5.0, poll_interval_sec: float = 1.0):
        self.target_flag = target_flag
        self.agent_path = os.path.abspath(agent_path or sys.executable if getattr(sys, 'frozen', False) else __file__)
        self.max_restart_burst = max_restart_burst
        self.burst_window_sec = burst_window_sec
        self.cooldown_backoff_sec = cooldown_backoff_sec
        self.poll_interval_sec = poll_interval_sec

        self.current_worker: Optional[WorkerProcessInfo] = None
        self.active_session_id: int = 1
        self.restart_history: List[float] = []
        self.total_restarts: int = 0
        self.consecutive_crashes: int = 0
        self.last_restart_time: float = 0.0
        self.in_cooldown_until: float = 0.0
        self.supervisor_state: str = "INITIALIZING"
        self._lock = threading.Lock()
        self._stop_requested = False

    def get_active_session_id(self) -> int:
        """
        Detects active console / interactive desktop session.
        Uses WTSGetActiveConsoleSessionId() with ProcessIdToSessionId fallback.
        """
        if not is_windows:
            return 1

        try:
            sess = kernel32.WTSGetActiveConsoleSessionId()
            if sess != 0xFFFFFFFF and sess > 0:
                return int(sess)
        except Exception:
            pass

        # Fallback: Find explorer.exe PID and get its session ID
        try:
            hSnap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            if hSnap and hSnap != INVALID_HANDLE_VALUE:
                pe = PROCESSENTRY32()
                pe.dwSize = ctypes.sizeof(PROCESSENTRY32)
                if kernel32.Process32First(hSnap, ctypes.byref(pe)):
                    while True:
                        name = pe.szExeFile.decode('latin1', errors='ignore').lower()
                        if 'explorer.exe' in name:
                            s = ctypes.wintypes.DWORD()
                            if kernel32.ProcessIdToSessionId(pe.th32ProcessID, ctypes.byref(s)):
                                if s.value > 0:
                                    kernel32.CloseHandle(hSnap)
                                    return int(s.value)
                        if not kernel32.Process32Next(hSnap, ctypes.byref(pe)):
                            break
                kernel32.CloseHandle(hSnap)
        except Exception:
            pass

        return 1

    def acquire_session_token(self, session_id: int) -> Optional[int]:
        """
        Acquires an elevated primary token targeting session_id using a 3-tier strategy:
        1. WTSQueryUserToken(session_id) + DuplicateTokenEx(TokenPrimary)
        2. Session-specific privileged process token duplication (winlogon.exe / explorer.exe)
        3. Current SYSTEM process token cloning + SetTokenInformation(TokenSessionId)
        """
        if not is_windows:
            return None

        # Tier 1: WTSQueryUserToken
        try:
            h_tok = ctypes.c_void_p()
            if wtsapi32.WTSQueryUserToken(ctypes.wintypes.DWORD(session_id), ctypes.byref(h_tok)):
                h_dup = ctypes.c_void_p()
                if advapi32.DuplicateTokenEx(h_tok, TOKEN_ALL_ACCESS, None, SECURITY_IMPERSONATION, TOKEN_PRIMARY, ctypes.byref(h_dup)):
                    kernel32.CloseHandle(h_tok)
                    # Assign target session ID to token
                    s_id = ctypes.wintypes.DWORD(session_id)
                    advapi32.SetTokenInformation(h_dup, TOKEN_SESSION_ID, ctypes.byref(s_id), ctypes.sizeof(s_id))
                    return h_dup.value
                kernel32.CloseHandle(h_tok)
        except Exception:
            pass

        # Tier 2: Process token duplication from target session (winlogon.exe, explorer.exe)
        try:
            hSnap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            if hSnap and hSnap != INVALID_HANDLE_VALUE:
                pe = PROCESSENTRY32()
                pe.dwSize = ctypes.sizeof(PROCESSENTRY32)
                candidates = []
                if kernel32.Process32First(hSnap, ctypes.byref(pe)):
                    while True:
                        name = pe.szExeFile.decode('latin1', errors='ignore').lower()
                        s = ctypes.wintypes.DWORD()
                        if kernel32.ProcessIdToSessionId(pe.th32ProcessID, ctypes.byref(s)):
                            if s.value == session_id and any(proc in name for proc in ['winlogon.exe', 'explorer.exe', 'logonui.exe']):
                                candidates.append((name, pe.th32ProcessID))
                        if not kernel32.Process32Next(hSnap, ctypes.byref(pe)):
                            break
                kernel32.CloseHandle(hSnap)

                candidates.sort(key=lambda x: 0 if 'winlogon' in x[0] else 1)
                for _, pid in candidates:
                    hProc = kernel32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
                    if hProc:
                        hTok = ctypes.c_void_p()
                        if advapi32.OpenProcessToken(hProc, TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_QUERY, ctypes.byref(hTok)):
                            hDup = ctypes.c_void_p()
                            if advapi32.DuplicateTokenEx(hTok, TOKEN_ALL_ACCESS, None, SECURITY_IMPERSONATION, TOKEN_PRIMARY, ctypes.byref(hDup)):
                                kernel32.CloseHandle(hTok)
                                kernel32.CloseHandle(hProc)
                                s_id = ctypes.wintypes.DWORD(session_id)
                                advapi32.SetTokenInformation(hDup, TOKEN_SESSION_ID, ctypes.byref(s_id), ctypes.sizeof(s_id))
                                return hDup.value
                            kernel32.CloseHandle(hTok)
                        kernel32.CloseHandle(hProc)
        except Exception:
            pass

        # Tier 3: Clone current SYSTEM process token and redirect to session_id
        try:
            hToken = ctypes.c_void_p()
            if advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), TOKEN_ALL_ACCESS, ctypes.byref(hToken)):
                hDup = ctypes.c_void_p()
                if advapi32.DuplicateTokenEx(hToken, TOKEN_ALL_ACCESS, None, SECURITY_IMPERSONATION, TOKEN_PRIMARY, ctypes.byref(hDup)):
                    kernel32.CloseHandle(hToken)
                    s_id = ctypes.wintypes.DWORD(session_id)
                    advapi32.SetTokenInformation(hDup, TOKEN_SESSION_ID, ctypes.byref(s_id), ctypes.sizeof(s_id))
                    return hDup.value
                kernel32.CloseHandle(hToken)
        except Exception:
            pass

        return None

    def inject_worker_in_session(self, session_id: int) -> Optional[WorkerProcessInfo]:
        """
        Launches worker process inside the specified session context.
        Uses CreateProcessAsUserW with environment block if token available,
        otherwise falls back to subprocess for non-service / dev environments.
        """
        token = self.acquire_session_token(session_id)

        # Prepare executable command line
        if getattr(sys, 'frozen', False):
            cmd = f'"{self.agent_path}" {self.target_flag}'
            exec_args = [self.agent_path, self.target_flag]
        else:
            cmd = f'"{sys.executable}" "{self.agent_path}" {self.target_flag}'
            exec_args = [sys.executable, self.agent_path, self.target_flag]

        if not token or not is_windows:
            # Fallback path for interactive user / testing environment without SYSTEM token
            try:
                p = subprocess.Popen(exec_args, close_fds=True)
                info = WorkerProcessInfo(
                    pid=p.pid,
                    session_id=session_id,
                    desktop="UserDesktop",
                    popen_obj=p
                )
                return info
            except Exception:
                return None

        # Elevated injection via CreateProcessAsUserW
        env_block = ctypes.c_void_p()
        userenv.CreateEnvironmentBlock(ctypes.byref(env_block), token, False)

        desktops_to_try = ["WinSta0\\Default", "WinSta0\\Winlogon", ""]
        pi = PROCESS_INFORMATION()
        launched = False
        target_desktop = "WinSta0\\Default"

        for d in desktops_to_try:
            si = STARTUPINFO()
            si.cb = ctypes.sizeof(STARTUPINFO)
            si.lpDesktop = d if d else None
            si.dwFlags = 0x00000001  # STARTF_USESHOWWINDOW
            si.wShowWindow = 0       # SW_HIDE

            cmd_buf = ctypes.create_unicode_buffer(cmd)
            flags = CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | NORMAL_PRIORITY_CLASS

            ok = advapi32.CreateProcessAsUserW(
                token, None, cmd_buf, None, None, False,
                flags, env_block if env_block else None,
                None, ctypes.byref(si), ctypes.byref(pi)
            )
            if ok:
                launched = True
                target_desktop = d or "Default"
                break

        if env_block:
            userenv.DestroyEnvironmentBlock(env_block)
        kernel32.CloseHandle(token)

        if launched:
            return WorkerProcessInfo(
                pid=int(pi.dwProcessId),
                session_id=session_id,
                h_process=pi.hProcess,
                h_thread=pi.hThread,
                desktop=target_desktop
            )

        return None

    def is_burst_throttled(self, now: float) -> bool:
        """
        Checks whether restart frequency exceeds max_restart_burst within burst_window_sec.
        Cleans outdated restart timestamps from history.
        """
        cutoff = now - self.burst_window_sec
        self.restart_history = [t for t in self.restart_history if t >= cutoff]
        return len(self.restart_history) >= self.max_restart_burst

    def step(self) -> Dict[str, Any]:
        """
        Executes one supervisory evaluation cycle:
        1. Checks active session ID. If changed, terminates old worker and switches.
        2. Checks worker health. If dead/crashed, verifies throttle and respawns.
        3. Returns status dictionary.
        """
        with self._lock:
            now = time.time()
            current_active_session = self.get_active_session_id()

            # 1. Check for Active Session Switch (e.g. User switch or Winlogon transition)
            if self.current_worker and self.current_worker.is_alive():
                if current_active_session != self.active_session_id and current_active_session > 0:
                    # Session transition detected
                    self.current_worker.terminate()
                    self.current_worker = None
                    self.active_session_id = current_active_session
                    self.supervisor_state = "SESSION_SWITCHING"
                    return self.get_status()
                else:
                    self.supervisor_state = "ACTIVE"
                    return self.get_status()

            # 2. If worker is dead or None, assess restart eligibility
            if self.current_worker is None or not self.current_worker.is_alive():
                self.active_session_id = current_active_session

                # Check if currently in cooldown
                if now < self.in_cooldown_until:
                    self.supervisor_state = "BACKOFF_THROTTLED"
                    return self.get_status()

                # Check if crash burst threshold exceeded
                if self.is_burst_throttled(now):
                    self.in_cooldown_until = now + self.cooldown_backoff_sec
                    self.supervisor_state = "BACKOFF_THROTTLED"
                    return self.get_status()

                # Attempt launch
                self.supervisor_state = "LAUNCHING"
                worker = self.inject_worker_in_session(self.active_session_id)
                if worker:
                    self.current_worker = worker
                    self.restart_history.append(now)
                    self.total_restarts += 1
                    self.last_restart_time = now
                    self.consecutive_crashes = 0
                    self.supervisor_state = "ACTIVE"
                else:
                    self.consecutive_crashes += 1
                    self.restart_history.append(now)
                    self.in_cooldown_until = now + self.cooldown_backoff_sec
                    self.supervisor_state = "LAUNCH_FAILED"

            return self.get_status()

    def get_status(self) -> Dict[str, Any]:
        """Returns diagnostic telemetry dictionary of the supervisor and worker."""
        worker_info = None
        if self.current_worker:
            worker_info = {
                'pid': self.current_worker.pid,
                'sessionId': self.current_worker.session_id,
                'desktop': self.current_worker.desktop,
                'status': self.current_worker.status,
                'isAlive': self.current_worker.is_alive(),
                'exitCode': self.current_worker.exit_code,
                'uptimeSec': round(time.time() - self.current_worker.launch_time, 2)
            }

        return {
            'supervisorState': self.supervisor_state,
            'activeSessionId': self.active_session_id,
            'totalRestarts': self.total_restarts,
            'consecutiveCrashes': self.consecutive_crashes,
            'recentRestartBurstCount': len(self.restart_history),
            'inCooldownUntil': self.in_cooldown_until,
            'isThrottled': time.time() < self.in_cooldown_until,
            'worker': worker_info
        }

    def stop(self) -> None:
        """Terminates active worker and stops supervisor."""
        with self._lock:
            self._stop_requested = True
            if self.current_worker:
                self.current_worker.terminate()
                self.current_worker = None
            self.supervisor_state = "STOPPED"

    def run_loop(self, stop_event: Optional[threading.Event] = None, max_iterations: Optional[int] = None) -> None:
        """Runs supervisor monitoring loop until stopped or max_iterations reached."""
        iterations = 0
        while not self._stop_requested:
            if stop_event and stop_event.is_set():
                break

            self.step()
            iterations += 1
            if max_iterations and iterations >= max_iterations:
                break

            time.sleep(self.poll_interval_sec)

        self.stop()
