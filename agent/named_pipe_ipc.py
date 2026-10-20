"""
RemoteMM Enterprise - Win32 Named Pipe Inter-Process Communication (IPC)
------------------------------------------------------------------------
Implements Section 5 of the Enterprise Engineering Bible:
Enables secure communication between Session 0 (SYSTEM Service) and
Session > 0 (Interactive User Session Desktop Worker):
- Creates `\\\\.\\pipe\\RemoteMM_IPC_{HWID}`
- Strict SDDL DACL for SYSTEM, Builtin Admins, and Authenticated Users
- Message-based duplex data exchange for screen frames, inputs, and events
"""

import ctypes
import ctypes.wintypes
import json
import time

kernel32 = ctypes.windll.kernel32
advapi32 = ctypes.windll.advapi32

# Win32 Named Pipe Constants
PIPE_ACCESS_DUPLEX        = 0x00000003
PIPE_TYPE_MESSAGE         = 0x00000004
PIPE_READMODE_MESSAGE     = 0x00000002
PIPE_WAIT                 = 0x00000000
PIPE_UNLIMITED_INSTANCES  = 255
GENERIC_READ              = 0x80000000
GENERIC_WRITE             = 0x40000000
OPEN_EXISTING             = 3
INVALID_HANDLE_VALUE      = ctypes.c_void_p(-1).value
BUFFER_SIZE               = 65536  # 64 KB default buffer

# Error codes
ERROR_PIPE_BUSY           = 231
ERROR_NO_DATA             = 232
ERROR_PIPE_NOT_CONNECTED  = 233
ERROR_MORE_DATA           = 234
ERROR_PIPE_CONNECTED      = 535

class SECURITY_ATTRIBUTES(ctypes.Structure):
    _fields_ = [
        ('nLength', ctypes.wintypes.DWORD),
        ('lpSecurityDescriptor', ctypes.c_void_p),
        ('bInheritHandle', ctypes.wintypes.BOOL)
    ]

# Win32 Function Signatures
kernel32.CreateNamedPipeW.argtypes = [
    ctypes.c_wchar_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong,
    ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.POINTER(SECURITY_ATTRIBUTES)
]
kernel32.CreateNamedPipeW.restype = ctypes.c_void_p

kernel32.ConnectNamedPipe.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
kernel32.ConnectNamedPipe.restype = ctypes.c_bool

kernel32.DisconnectNamedPipe.argtypes = [ctypes.c_void_p]
kernel32.DisconnectNamedPipe.restype = ctypes.c_bool

kernel32.WaitNamedPipeW.argtypes = [ctypes.c_wchar_p, ctypes.c_ulong]
kernel32.WaitNamedPipeW.restype = ctypes.c_bool

kernel32.CreateFileW.argtypes = [
    ctypes.c_wchar_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p,
    ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p
]
kernel32.CreateFileW.restype = ctypes.c_void_p

kernel32.ReadFile.argtypes = [
    ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong,
    ctypes.POINTER(ctypes.wintypes.DWORD), ctypes.c_void_p
]
kernel32.ReadFile.restype = ctypes.c_bool

kernel32.WriteFile.argtypes = [
    ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong,
    ctypes.POINTER(ctypes.wintypes.DWORD), ctypes.c_void_p
]
kernel32.WriteFile.restype = ctypes.c_bool

kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
kernel32.CloseHandle.restype = ctypes.c_bool

kernel32.LocalFree.argtypes = [ctypes.c_void_p]
kernel32.LocalFree.restype = ctypes.c_void_p

advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
    ctypes.c_wchar_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p
]
advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = ctypes.c_bool


class NamedPipeError(Exception):
    """Raised on Win32 Named Pipe operations failure."""
    pass


def get_pipe_name_for_hwid(hwid: str) -> str:
    """Computes predictable named pipe path for a given device HWID."""
    clean = "".join(c for c in (hwid or "default") if c.isalnum())[:16]
    return f"\\\\.\\pipe\\RemoteMM_IPC_{clean}"


class NamedPipeServer:
    """
    Session 0 SYSTEM Named Pipe Server.
    Creates and listens on a message-mode named pipe with secure DACL.
    """
    def __init__(self, pipe_name: str):
        self.pipe_name = pipe_name
        self.handle = None
        self._p_sd = ctypes.c_void_p()
        self._is_connected = False

    def _create_security_attributes(self) -> SECURITY_ATTRIBUTES:
        # SDDL: SYSTEM (SY), Built-in Administrators (BA), and Authenticated Users (AU) Full Access (GA)
        sddl = "D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;AU)"
        ok = advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl, 1, ctypes.byref(self._p_sd), None
        )
        if not ok or not self._p_sd:
            raise NamedPipeError("Failed to convert security descriptor for named pipe")

        sa = SECURITY_ATTRIBUTES()
        sa.nLength = ctypes.sizeof(sa)
        sa.lpSecurityDescriptor = self._p_sd
        sa.bInheritHandle = False
        return sa

    def start(self):
        """Creates the named pipe instance and prepares for client connections."""
        sa = self._create_security_attributes()
        h = kernel32.CreateNamedPipeW(
            self.pipe_name,
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
            BUFFER_SIZE,
            BUFFER_SIZE,
            5000,
            ctypes.byref(sa)
        )
        if not h or h == INVALID_HANDLE_VALUE:
            err = kernel32.GetLastError()
            raise NamedPipeError(f"CreateNamedPipeW failed for '{self.pipe_name}' (Win32 Error {err})")
        self.handle = h
        return self

    def wait_for_connection(self) -> bool:
        """Blocks until a client connects to the named pipe."""
        if not self.handle:
            raise NamedPipeError("Named pipe server is not started")

        ok = kernel32.ConnectNamedPipe(self.handle, None)
        err = kernel32.GetLastError()
        if ok or err == ERROR_PIPE_CONNECTED:
            self._is_connected = True
            return True
        return False

    def send(self, data: bytes | str | dict) -> int:
        """Transmits a message to connected client."""
        if not self.handle or not self._is_connected:
            raise NamedPipeError("Cannot send: pipe is not connected")

        if isinstance(data, dict):
            raw = json.dumps(data, separators=(',', ':')).encode('utf-8')
        elif isinstance(data, str):
            raw = data.encode('utf-8')
        elif isinstance(data, (bytes, bytearray)):
            raw = bytes(data)
        else:
            raise NamedPipeError(f"Unsupported payload type: {type(data)}")

        written = ctypes.wintypes.DWORD(0)
        ok = kernel32.WriteFile(self.handle, raw, len(raw), ctypes.byref(written), None)
        if not ok:
            err = kernel32.GetLastError()
            raise NamedPipeError(f"WriteFile failed (Win32 Error {err})")
        return written.value

    def receive(self, max_size: int = BUFFER_SIZE) -> bytes:
        """Reads a message from connected client."""
        if not self.handle or not self._is_connected:
            raise NamedPipeError("Cannot receive: pipe is not connected")

        buf = (ctypes.c_char * max_size)()
        read = ctypes.wintypes.DWORD(0)
        ok = kernel32.ReadFile(self.handle, buf, max_size, ctypes.byref(read), None)
        if not ok:
            err = kernel32.GetLastError()
            if err in (ERROR_PIPE_NOT_CONNECTED, ERROR_NO_DATA):
                self._is_connected = False
                return b""
            raise NamedPipeError(f"ReadFile failed (Win32 Error {err})")

        return bytes(buf[:read.value])

    def disconnect(self):
        """Disconnects current client."""
        if self.handle and self._is_connected:
            kernel32.DisconnectNamedPipe(self.handle)
            self._is_connected = False

    def close(self):
        """Closes named pipe instance and frees security descriptors."""
        self.disconnect()
        if self.handle:
            kernel32.CloseHandle(self.handle)
            self.handle = None
        if self._p_sd:
            kernel32.LocalFree(self._p_sd)
            self._p_sd = ctypes.c_void_p()

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


class NamedPipeClient:
    """
    Session > 0 User Session Worker Client.
    Connects to the SYSTEM Session 0 Named Pipe.
    """
    def __init__(self, pipe_name: str):
        self.pipe_name = pipe_name
        self.handle = None

    def connect(self, timeout_ms: int = 5000) -> bool:
        """Connects to an existing named pipe instance."""
        start_time = time.time()
        timeout_sec = timeout_ms / 1000.0

        while True:
            h = kernel32.CreateFileW(
                self.pipe_name,
                GENERIC_READ | GENERIC_WRITE,
                0,
                None,
                OPEN_EXISTING,
                0,
                None
            )
            if h and h != INVALID_HANDLE_VALUE:
                self.handle = h
                return True

            err = kernel32.GetLastError()
            if err == ERROR_PIPE_BUSY:
                # Pipe is busy; wait for availability
                if not kernel32.WaitNamedPipeW(self.pipe_name, 1000):
                    time.sleep(0.1)
            else:
                time.sleep(0.1)

            if (time.time() - start_time) > timeout_sec:
                return False

    def send(self, data: bytes | str | dict) -> int:
        """Sends data to named pipe server."""
        if not self.handle:
            raise NamedPipeError("Pipe client is not connected")

        if isinstance(data, dict):
            raw = json.dumps(data, separators=(',', ':')).encode('utf-8')
        elif isinstance(data, str):
            raw = data.encode('utf-8')
        elif isinstance(data, (bytes, bytearray)):
            raw = bytes(data)
        else:
            raise NamedPipeError(f"Unsupported payload type: {type(data)}")

        written = ctypes.wintypes.DWORD(0)
        ok = kernel32.WriteFile(self.handle, raw, len(raw), ctypes.byref(written), None)
        if not ok:
            err = kernel32.GetLastError()
            raise NamedPipeError(f"Client WriteFile failed (Win32 Error {err})")
        return written.value

    def receive(self, max_size: int = BUFFER_SIZE) -> bytes:
        """Reads message from server."""
        if not self.handle:
            raise NamedPipeError("Pipe client is not connected")

        buf = (ctypes.c_char * max_size)()
        read = ctypes.wintypes.DWORD(0)
        ok = kernel32.ReadFile(self.handle, buf, max_size, ctypes.byref(read), None)
        if not ok:
            err = kernel32.GetLastError()
            if err in (ERROR_PIPE_NOT_CONNECTED, ERROR_NO_DATA):
                return b""
            raise NamedPipeError(f"Client ReadFile failed (Win32 Error {err})")

        return bytes(buf[:read.value])

    def close(self):
        """Closes client handle."""
        if self.handle:
            kernel32.CloseHandle(self.handle)
            self.handle = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
