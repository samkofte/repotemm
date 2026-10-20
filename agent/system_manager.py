"""
RemoteMM Enterprise - Pure Win32 System Manager
-----------------------------------------------
Provides high-performance, native Win32 process enumeration,
protected process termination, and system power management
without spawning cmd.exe, powershell.exe, or external shells.
Adheres strictly to docs/ENTERPRISE_ENGINEERING_BIBLE.md Section 6.
"""

import ctypes
from ctypes import wintypes
import os
import sys
import time

# DLL Handlers
kernel32 = ctypes.windll.kernel32
advapi32 = ctypes.windll.advapi32
user32 = ctypes.windll.user32
psapi = getattr(ctypes.windll, 'psapi', kernel32)
powrprof = getattr(ctypes.windll, 'powrprof', None)

# Win32 Structures
class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ('dwSize', wintypes.DWORD),
        ('cntUsage', wintypes.DWORD),
        ('th32ProcessID', wintypes.DWORD),
        ('th32DefaultHeapID', ctypes.c_size_t),
        ('th32ModuleID', wintypes.DWORD),
        ('cntThreads', wintypes.DWORD),
        ('th32ParentProcessID', wintypes.DWORD),
        ('pcPriClassBase', wintypes.LONG),
        ('dwFlags', wintypes.DWORD),
        ('szExeFile', wintypes.WCHAR * 260)
    ]

class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
    _fields_ = [
        ('cb', wintypes.DWORD),
        ('PageFaultCount', wintypes.DWORD),
        ('PeakWorkingSetSize', ctypes.c_size_t),
        ('WorkingSetSize', ctypes.c_size_t),
        ('QuotaPeakPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t),
        ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
        ('PagefileUsage', ctypes.c_size_t),
        ('PeakPagefileUsage', ctypes.c_size_t),
        ('PrivateUsage', ctypes.c_size_t)
    ]

class LUID(ctypes.Structure):
    _fields_ = [('LowPart', wintypes.DWORD), ('HighPart', wintypes.LONG)]

class LUID_AND_ATTRIBUTES(ctypes.Structure):
    _fields_ = [('Luid', LUID), ('Attributes', wintypes.DWORD)]

class TOKEN_PRIVILEGES(ctypes.Structure):
    _fields_ = [
        ('PrivilegeCount', wintypes.DWORD),
        ('Privileges', LUID_AND_ATTRIBUTES * 1)
    ]

# Setup LookupAccountSidW ctypes prototype
advapi32.LookupAccountSidW.argtypes = [
    wintypes.LPCWSTR,
    ctypes.c_void_p,
    wintypes.LPWSTR,
    ctypes.POINTER(wintypes.DWORD),
    wintypes.LPWSTR,
    ctypes.POINTER(wintypes.DWORD),
    ctypes.POINTER(wintypes.DWORD)
]
advapi32.LookupAccountSidW.restype = wintypes.BOOL

# Protected Kernel and Critical Services list (Bölüm 6.1)
CRITICAL_PROCESS_NAMES = {
    'system',
    'smss.exe',
    'csrss.exe',
    'wininit.exe',
    'services.exe',
    'lsass.exe',
    'svchost.exe',
    'remotemm_agent.exe',
    'remotemmagent.exe'
}

def enable_privilege(privilege_name: str = "SeShutdownPrivilege") -> bool:
    """Enables a specific privilege in the current process token (e.g. SeShutdownPrivilege, SeDebugPrivilege)."""
    try:
        hToken = wintypes.HANDLE()
        if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0020 | 0x0008, ctypes.byref(hToken)):
            return False

        luid = LUID()
        if not advapi32.LookupPrivilegeValueW(None, privilege_name, ctypes.byref(luid)):
            kernel32.CloseHandle(hToken)
            return False

        tp = TOKEN_PRIVILEGES()
        tp.PrivilegeCount = 1
        tp.Privileges[0].Luid = luid
        tp.Privileges[0].Attributes = 0x00000002  # SE_PRIVILEGE_ENABLED

        res = advapi32.AdjustTokenPrivileges(hToken, False, ctypes.byref(tp), 0, None, None)
        kernel32.CloseHandle(hToken)
        return bool(res)
    except Exception:
        return False

def get_process_owner(hProc) -> str:
    """Returns DOMAIN\\Username for an opened process handle, or SYSTEM on error."""
    try:
        hToken = wintypes.HANDLE()
        if not advapi32.OpenProcessToken(hProc, 0x0008, ctypes.byref(hToken)):
            return 'SYSTEM'
        
        needed = wintypes.DWORD()
        advapi32.GetTokenInformation(hToken, 1, None, 0, ctypes.byref(needed))  # 1 = TokenUser
        if needed.value == 0:
            kernel32.CloseHandle(hToken)
            return 'SYSTEM'

        buf = (ctypes.c_byte * needed.value)()
        user_str = 'SYSTEM'
        if advapi32.GetTokenInformation(hToken, 1, buf, needed.value, ctypes.byref(needed)):
            pSid = ctypes.cast(buf, ctypes.POINTER(ctypes.c_void_p))[0]
            name_buf = ctypes.create_unicode_buffer(256)
            cch_name = wintypes.DWORD(256)
            dom_buf = ctypes.create_unicode_buffer(256)
            cch_dom = wintypes.DWORD(256)
            sid_type = wintypes.DWORD()
            if advapi32.LookupAccountSidW(None, pSid, name_buf, ctypes.byref(cch_name), dom_buf, ctypes.byref(cch_dom), ctypes.byref(sid_type)):
                if dom_buf.value and name_buf.value:
                    user_str = f"{dom_buf.value}\\{name_buf.value}"
                elif name_buf.value:
                    user_str = name_buf.value
        kernel32.CloseHandle(hToken)
        return user_str
    except Exception:
        return 'SYSTEM'

def enum_processes_native(limit: int = 100) -> list:
    """
    Enumerates running processes natively via Toolhelp32Snapshot and PSAPI.
    Zero subprocess overhead. Completes in ~1-5ms.
    """
    enable_privilege("SeDebugPrivilege")
    results = []
    hSnap = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)  # TH32CS_SNAPPROCESS
    if hSnap == wintypes.HANDLE(-1).value or not hSnap:
        return results

    pe = PROCESSENTRY32W()
    pe.dwSize = ctypes.sizeof(PROCESSENTRY32W)

    my_pid = os.getpid()

    if kernel32.Process32FirstW(hSnap, ctypes.byref(pe)):
        while True:
            pid = int(pe.th32ProcessID)
            name = str(pe.szExeFile)
            is_protected = (pid <= 4 or pid == my_pid or name.lower() in CRITICAL_PROCESS_NAMES)

            ws_bytes = 0
            user_owner = 'SYSTEM' if pid <= 4 else 'N/A'

            # Try to query additional memory and user info
            if pid > 4:
                # PROCESS_QUERY_LIMITED_INFORMATION (0x1000) | PROCESS_VM_READ (0x0010)
                hProc = kernel32.OpenProcess(0x1000 | 0x0010, False, pid)
                if not hProc:
                    hProc = kernel32.OpenProcess(0x1000, False, pid)

                if hProc:
                    try:
                        pmc = PROCESS_MEMORY_COUNTERS_EX()
                        pmc.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX)
                        if psapi.GetProcessMemoryInfo(hProc, ctypes.byref(pmc), pmc.cb):
                            ws_bytes = int(pmc.WorkingSetSize)
                    except Exception:
                        pass
                    
                    try:
                        user_owner = get_process_owner(hProc)
                    except Exception:
                        pass

                    kernel32.CloseHandle(hProc)

            results.append({
                'Id': pid,
                'ProcessName': name,
                'CPU': '0.0%',
                'WorkingSet64': ws_bytes,
                'User': user_owner,
                'isProtected': is_protected
            })

            if len(results) >= limit:
                break

            if not kernel32.Process32NextW(hSnap, ctypes.byref(pe)):
                break

    kernel32.CloseHandle(hSnap)
    return results

def is_process_protected(pid: int, process_name: str = '') -> bool:
    """Verifies whether a PID or process name is protected under Kernel Kill Protection."""
    if pid <= 4 or pid == os.getpid():
        return True
    
    if process_name and process_name.lower() in CRITICAL_PROCESS_NAMES:
        return True

    # Check by resolving name via snapshot if process_name not provided
    hSnap = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
    if hSnap and hSnap != wintypes.HANDLE(-1).value:
        pe = PROCESSENTRY32W()
        pe.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        if kernel32.Process32FirstW(hSnap, ctypes.byref(pe)):
            while True:
                if pe.th32ProcessID == pid:
                    n = str(pe.szExeFile).lower()
                    kernel32.CloseHandle(hSnap)
                    return n in CRITICAL_PROCESS_NAMES
                if not kernel32.Process32NextW(hSnap, ctypes.byref(pe)):
                    break
        kernel32.CloseHandle(hSnap)

    return False

def terminate_process_native(pid: int) -> tuple[bool, str]:
    """
    Safely terminates a process using Win32 TerminateProcess API.
    Guarantees kernel critical process shield.
    """
    if is_process_protected(pid):
        return False, "ACCESS_DENIED_CRITICAL_PROCESS"

    # PROCESS_TERMINATE (0x0001)
    hProc = kernel32.OpenProcess(0x0001, False, pid)
    if not hProc:
        err = kernel32.GetLastError()
        return False, f"OPEN_PROCESS_FAILED_{err}"

    ok = kernel32.TerminateProcess(hProc, 1)
    err = kernel32.GetLastError()
    kernel32.CloseHandle(hProc)

    if ok:
        return True, "SUCCESS"
    return False, f"TERMINATE_FAILED_{err}"

def execute_power_action_native(action: str, force: bool = True, timeout: int = 1, reason: str = "RemoteMM Operator Power Action") -> tuple[bool, str]:
    """
    Executes native power actions without shell invocation.
    Allowed actions: reboot, shutdown, lock, sleep, hibernate, logoff, abort.
    """
    act = str(action).lower().strip()
    enable_privilege("SeShutdownPrivilege")

    if act == 'reboot':
        # InitiateSystemShutdownExW(lpMachineName, lpMessage, dwTimeout, bForceAppsClosed, bRebootAfterShutdown, dwReason)
        # SHTDN_REASON_FLAG_PLANNED = 0x80000000
        ok = advapi32.InitiateSystemShutdownExW(None, reason, timeout, force, True, 0x80000000)
        return (bool(ok), "SUCCESS" if ok else f"REBOOT_FAILED_{kernel32.GetLastError()}")

    elif act == 'shutdown':
        ok = advapi32.InitiateSystemShutdownExW(None, reason, timeout, force, False, 0x80000000)
        return (bool(ok), "SUCCESS" if ok else f"SHUTDOWN_FAILED_{kernel32.GetLastError()}")

    elif act == 'lock':
        ok = user32.LockWorkStation()
        return (bool(ok), "SUCCESS" if ok else f"LOCK_FAILED_{kernel32.GetLastError()}")

    elif act == 'sleep':
        if powrprof and hasattr(powrprof, 'SetSuspendState'):
            # SetSuspendState(Hibernate, ForceCritical, DisableWakeEvent)
            ok = powrprof.SetSuspendState(False, force, False)
            return (bool(ok), "SUCCESS" if ok else f"SLEEP_FAILED_{kernel32.GetLastError()}")
        return False, "POWRPROF_UNAVAILABLE"

    elif act == 'hibernate':
        if powrprof and hasattr(powrprof, 'SetSuspendState'):
            ok = powrprof.SetSuspendState(True, force, False)
            return (bool(ok), "SUCCESS" if ok else f"HIBERNATE_FAILED_{kernel32.GetLastError()}")
        return False, "POWRPROF_UNAVAILABLE"

    elif act == 'logoff':
        # ExitWindowsEx(EWX_LOGOFF | (EWX_FORCE if force else 0), 0)
        flags = 0x00000000 | (0x00000004 if force else 0)
        ok = user32.ExitWindowsEx(flags, 0)
        return (bool(ok), "SUCCESS" if ok else f"LOGOFF_FAILED_{kernel32.GetLastError()}")

    elif act == 'abort':
        ok = advapi32.AbortSystemShutdownW(None)
        return (bool(ok), "SUCCESS" if ok else f"ABORT_FAILED_{kernel32.GetLastError()}")

    return False, f"INVALID_ACTION_{action}"
