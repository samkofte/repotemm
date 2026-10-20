"""
RemoteMM Enterprise - Native Win32 Service Control Manager (Advapi32)
---------------------------------------------------------------------
Implements Section 6.1 of the Enterprise Engineering Bible.
Provides zero-shell, microsecond-latency Windows Service control:
- StartServiceW
- ControlService (SERVICE_CONTROL_STOP)
- QueryServiceStatusEx
- EnumServicesStatusExW
- Protected kernel service guard (Anti-tamper protection)
"""

import ctypes
import ctypes.wintypes
import time

advapi32 = ctypes.windll.advapi32
kernel32 = ctypes.windll.kernel32

# SC Manager Access Rights
SC_MANAGER_CONNECT             = 0x0001
SC_MANAGER_ENUMERATE_SERVICE   = 0x0004
SC_MANAGER_ALL_ACCESS          = 0xF003F

# Service Access Rights
SERVICE_QUERY_CONFIG           = 0x0001
SERVICE_QUERY_STATUS           = 0x0004
SERVICE_START                  = 0x0010
SERVICE_STOP                   = 0x0020
SERVICE_PAUSE_CONTINUE         = 0x0040
SERVICE_ALL_ACCESS             = 0xF01FF

# Control Codes
SERVICE_CONTROL_STOP           = 0x00000001
SERVICE_CONTROL_PAUSE          = 0x00000002
SERVICE_CONTROL_CONTINUE       = 0x00000003
SERVICE_CONTROL_INTERROGATE    = 0x00000004

# Service States
SERVICE_STOPPED                = 0x00000001
SERVICE_START_PENDING          = 0x00000002
SERVICE_STOP_PENDING           = 0x00000003
SERVICE_RUNNING                = 0x00000004
SERVICE_CONTINUE_PENDING       = 0x00000005
SERVICE_PAUSE_PENDING          = 0x00000006
SERVICE_PAUSED                 = 0x00000007

# Service Types & Info Levels
SERVICE_WIN32                  = 0x00000030
SERVICE_STATE_ALL              = 0x00000003
SC_STATUS_PROCESS_INFO         = 0

STATE_NAMES = {
    SERVICE_STOPPED: 'STOPPED',
    SERVICE_START_PENDING: 'START_PENDING',
    SERVICE_STOP_PENDING: 'STOP_PENDING',
    SERVICE_RUNNING: 'RUNNING',
    SERVICE_CONTINUE_PENDING: 'CONTINUE_PENDING',
    SERVICE_PAUSE_PENDING: 'PAUSE_PENDING',
    SERVICE_PAUSED: 'PAUSED'
}

# Section 6.1: Protected services that cannot be stopped to avoid disabling the host or remote agent
PROTECTED_SERVICES = {
    'remotemmagent',
    'rpcss',
    'dcomlaunch',
    'eventlog',
    'plugplay',
    'lanmanworkstation',
    'samss',
    'lsass',
    'wininit'
}

class SERVICE_STATUS(ctypes.Structure):
    _fields_ = [
        ('dwServiceType', ctypes.c_ulong),
        ('dwCurrentState', ctypes.c_ulong),
        ('dwControlsAccepted', ctypes.c_ulong),
        ('dwWin32ExitCode', ctypes.c_ulong),
        ('dwServiceSpecificExitCode', ctypes.c_ulong),
        ('dwCheckPoint', ctypes.c_ulong),
        ('dwWaitHint', ctypes.c_ulong),
    ]

class SERVICE_STATUS_PROCESS(ctypes.Structure):
    _fields_ = [
        ('dwServiceType', ctypes.c_ulong),
        ('dwCurrentState', ctypes.c_ulong),
        ('dwControlsAccepted', ctypes.c_ulong),
        ('dwWin32ExitCode', ctypes.c_ulong),
        ('dwServiceSpecificExitCode', ctypes.c_ulong),
        ('dwCheckPoint', ctypes.c_ulong),
        ('dwWaitHint', ctypes.c_ulong),
        ('dwProcessId', ctypes.c_ulong),
        ('dwServiceFlags', ctypes.c_ulong),
    ]

class ENUM_SERVICE_STATUS_PROCESSW(ctypes.Structure):
    _fields_ = [
        ('lpServiceName', ctypes.c_wchar_p),
        ('lpDisplayName', ctypes.c_wchar_p),
        ('ServiceStatusProcess', SERVICE_STATUS_PROCESS)
    ]

# Setup Win32 Function Signatures
advapi32.OpenSCManagerW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_ulong]
advapi32.OpenSCManagerW.restype = ctypes.c_void_p

advapi32.OpenServiceW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_ulong]
advapi32.OpenServiceW.restype = ctypes.c_void_p

advapi32.StartServiceW.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p]
advapi32.StartServiceW.restype = ctypes.c_bool

advapi32.ControlService.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(SERVICE_STATUS)]
advapi32.ControlService.restype = ctypes.c_bool

advapi32.QueryServiceStatusEx.argtypes = [
    ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong)
]
advapi32.QueryServiceStatusEx.restype = ctypes.c_bool

advapi32.EnumServicesStatusExW.argtypes = [
    ctypes.c_void_p, ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong,
    ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong),
    ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.c_wchar_p
]
advapi32.EnumServicesStatusExW.restype = ctypes.c_bool

advapi32.CloseServiceHandle.argtypes = [ctypes.c_void_p]
advapi32.CloseServiceHandle.restype = ctypes.c_bool

def is_protected_service(service_name: str) -> bool:
    """Checks if service name is in critical kernel protection whitelist."""
    if not service_name:
        return False
    return service_name.strip().lower() in PROTECTED_SERVICES

def query_service_status(service_name: str) -> dict | None:
    """
    Natively queries status of a given Windows service via SCM.
    Returns status dict or None if service not found.
    """
    h_scm = advapi32.OpenSCManagerW(None, None, SC_MANAGER_CONNECT)
    if not h_scm:
        return None
    try:
        h_svc = advapi32.OpenServiceW(h_scm, service_name, SERVICE_QUERY_STATUS)
        if not h_svc:
            return None
        try:
            ssp = SERVICE_STATUS_PROCESS()
            bytes_needed = ctypes.c_ulong(0)
            ok = advapi32.QueryServiceStatusEx(
                h_svc, SC_STATUS_PROCESS_INFO, ctypes.byref(ssp),
                ctypes.sizeof(ssp), ctypes.byref(bytes_needed)
            )
            if not ok:
                return None
            state_num = ssp.dwCurrentState
            return {
                'serviceName': service_name,
                'status': STATE_NAMES.get(state_num, f'UNKNOWN_{state_num}'),
                'pid': ssp.dwProcessId,
                'isProtected': is_protected_service(service_name)
            }
        finally:
            advapi32.CloseServiceHandle(h_svc)
    finally:
        advapi32.CloseServiceHandle(h_scm)

def control_service(service_name: str, action: str) -> tuple[bool, str]:
    """
    Executes a parametric service control action ('start', 'stop', 'restart')
    using pure Win32 API calls without spawning shell processes.
    """
    action = (action or '').strip().lower()
    if action not in ('start', 'stop', 'restart'):
        return False, f"Invalid action: {action}"

    if action in ('stop', 'restart') and is_protected_service(service_name):
        return False, f"Action '{action}' is strictly forbidden on protected service '{service_name}' (Section 6.1)"

    h_scm = advapi32.OpenSCManagerW(None, None, SC_MANAGER_ALL_ACCESS)
    if not h_scm:
        err = kernel32.GetLastError()
        return False, f"OpenSCManagerW failed (Error {err})"

    try:
        desired_access = SERVICE_START | SERVICE_STOP | SERVICE_QUERY_STATUS
        h_svc = advapi32.OpenServiceW(h_scm, service_name, desired_access)
        if not h_svc:
            err = kernel32.GetLastError()
            return False, f"OpenServiceW failed for '{service_name}' (Error {err})"

        try:
            status = SERVICE_STATUS()

            if action == 'start':
                ok = advapi32.StartServiceW(h_svc, 0, None)
                if not ok:
                    err = kernel32.GetLastError()
                    if err == 1056:  # ERROR_SERVICE_ALREADY_RUNNING
                        return True, "Service is already running"
                    return False, f"StartServiceW failed (Win32 Error {err})"
                return True, "Service started successfully"

            elif action == 'stop':
                ok = advapi32.ControlService(h_svc, SERVICE_CONTROL_STOP, ctypes.byref(status))
                if not ok:
                    err = kernel32.GetLastError()
                    if err == 1062:  # ERROR_SERVICE_NOT_ACTIVE
                        return True, "Service is already stopped"
                    return False, f"ControlService(STOP) failed (Win32 Error {err})"
                return True, "Service stopped successfully"

            elif action == 'restart':
                # Stop service
                advapi32.ControlService(h_svc, SERVICE_CONTROL_STOP, ctypes.byref(status))
                # Wait briefly for stopped state
                for _ in range(15):
                    ssp = SERVICE_STATUS_PROCESS()
                    bn = ctypes.c_ulong(0)
                    if advapi32.QueryServiceStatusEx(h_svc, SC_STATUS_PROCESS_INFO, ctypes.byref(ssp), ctypes.sizeof(ssp), ctypes.byref(bn)):
                        if ssp.dwCurrentState == SERVICE_STOPPED:
                            break
                    time.sleep(0.2)

                # Start service
                ok = advapi32.StartServiceW(h_svc, 0, None)
                if not ok:
                    err = kernel32.GetLastError()
                    return False, f"Restart failed during StartServiceW (Win32 Error {err})"
                return True, "Service restarted successfully"

        finally:
            advapi32.CloseServiceHandle(h_svc)
    finally:
        advapi32.CloseServiceHandle(h_scm)

def enum_services_native(limit: int = 150) -> list[dict]:
    """
    Enumerates Windows services directly using EnumServicesStatusExW.
    Pure Win32, sub-millisecond execution, zero child process overhead.
    """
    h_scm = advapi32.OpenSCManagerW(None, None, SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE)
    if not h_scm:
        return []

    services = []
    try:
        bytes_needed = ctypes.c_ulong(0)
        services_returned = ctypes.c_ulong(0)
        resume_handle = ctypes.c_ulong(0)

        # First call to get required buffer size
        advapi32.EnumServicesStatusExW(
            h_scm, SC_STATUS_PROCESS_INFO, SERVICE_WIN32, SERVICE_STATE_ALL,
            None, 0, ctypes.byref(bytes_needed), ctypes.byref(services_returned),
            ctypes.byref(resume_handle), None
        )

        size = bytes_needed.value
        if size == 0:
            return []

        buf = (ctypes.c_byte * size)()
        ok = advapi32.EnumServicesStatusExW(
            h_scm, SC_STATUS_PROCESS_INFO, SERVICE_WIN32, SERVICE_STATE_ALL,
            ctypes.byref(buf), size, ctypes.byref(bytes_needed),
            ctypes.byref(services_returned), ctypes.byref(resume_handle), None
        )

        if not ok and kernel32.GetLastError() != 234:  # ERROR_MORE_DATA
            return []

        count = min(services_returned.value, limit)
        ptr = ctypes.cast(buf, ctypes.POINTER(ENUM_SERVICE_STATUS_PROCESSW))

        for i in range(count):
            item = ptr[i]
            s_name = item.lpServiceName or ''
            d_name = item.lpDisplayName or s_name
            state_num = item.ServiceStatusProcess.dwCurrentState
            services.append({
                'name': s_name,
                'displayName': d_name,
                'status': STATE_NAMES.get(state_num, 'UNKNOWN'),
                'startType': 'Automatic',
                'isProtected': is_protected_service(s_name)
            })

    except Exception:
        pass
    finally:
        advapi32.CloseServiceHandle(h_scm)

    return services
