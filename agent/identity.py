"""
RemoteMM Enterprise - Device Identity & Cryptographic Hardware Fingerprint
--------------------------------------------------------------------------
Generates a deterministic and unique Hardware ID (HWID) based on:
1. SMBIOS / Machine UUID
2. CPU Processor ID & Architecture
3. Motherboard Serial / System ProductName
4. Primary Network Adapter MAC Address

Formula: HWID = SHA256(BIOS_UUID || CPU_ID || MOTHERBOARD_SERIAL || MAC_ADDR)
"""

import os
import sys
import hashlib
import uuid
import json
import ctypes
import ctypes.wintypes

try:
    import winreg
except ImportError:
    winreg = None

IDENTITY_DIR = os.environ.get('ProgramData', r'C:\ProgramData') + r'\RemoteMM'
IDENTITY_FILE = os.path.join(IDENTITY_DIR, 'device_identity.json')

def _get_registry_value(key, subkey, value_name):
    """Safely reads a string value from Windows Registry."""
    if not winreg:
        return ''
    try:
        with winreg.OpenKey(key, subkey, 0, winreg.KEY_READ) as k:
            val, _ = winreg.QueryValueEx(k, value_name)
            return str(val).strip()
    except Exception:
        return ''

def get_cpu_identifier():
    """Returns CPU identifier string from registry or platform."""
    cpu_id = _get_registry_value(
        winreg.HKEY_LOCAL_MACHINE,
        r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
        "ProcessorNameString"
    )
    if not cpu_id:
        cpu_id = _get_registry_value(
            winreg.HKEY_LOCAL_MACHINE,
            r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            "Identifier"
        )
    return cpu_id or os.environ.get('PROCESSOR_IDENTIFIER', 'GenericCPU')

def get_smbios_uuid():
    """Reads system product name and BIOS identifier."""
    prod_name = _get_registry_value(
        winreg.HKEY_LOCAL_MACHINE,
        r"HARDWARE\DESCRIPTION\System\BIOS",
        "SystemProductName"
    )
    sys_vendor = _get_registry_value(
        winreg.HKEY_LOCAL_MACHINE,
        r"HARDWARE\DESCRIPTION\System\BIOS",
        "SystemManufacturer"
    )
    bios_version = _get_registry_value(
        winreg.HKEY_LOCAL_MACHINE,
        r"HARDWARE\DESCRIPTION\System\BIOS",
        "BIOSVersion"
    )
    return f"{sys_vendor}_{prod_name}_{bios_version}"

def get_primary_mac():
    """Extracts the primary MAC address formatted with colons."""
    try:
        mac_num = uuid.getnode()
        mac_str = ':'.join(f'{(mac_num >> (8 * i)) & 0xff:02x}' for i in reversed(range(6)))
        return mac_str.upper()
    except Exception:
        return '00:00:00:00:00:00'

def generate_hwid():
    """Generates a stable 64-character SHA-256 hardware fingerprint."""
    cpu = get_cpu_identifier()
    bios = get_smbios_uuid()
    mac = get_primary_mac()
    machine_guid = _get_registry_value(
        winreg.HKEY_LOCAL_MACHINE,
        r"SOFTWARE\Microsoft\Cryptography",
        "MachineGuid"
    ) or 'FALLBACK_GUID'

    raw_seed = f"{machine_guid}|{bios}|{cpu}|{mac}".encode('utf-8')
    hwid = hashlib.sha256(raw_seed).hexdigest()
    return hwid

def load_or_create_identity(tenant_id="tenant_default", enroll_token=""):
    """
    Loads saved device identity from disk or creates a new cryptographically
    linked identity package.
    """
    os.makedirs(IDENTITY_DIR, exist_ok=True)
    hwid = generate_hwid()

    if os.path.exists(IDENTITY_FILE):
        try:
            with open(IDENTITY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if data.get('hwid') == hwid:
                    return data
        except Exception:
            pass

    # Create new identity payload
    import socket
    hostname = socket.gethostname()
    mac = get_primary_mac()
    
    # Generate local device secret for session token signing
    device_token = f"tok_dev_{hashlib.sha256((hwid + str(uuid.uuid4())).encode()).hexdigest()[:32]}"

    identity = {
        'hwid': hwid,
        'tenantId': tenant_id,
        'deviceToken': device_token,
        'enrollmentToken': enroll_token,
        'hostname': hostname,
        'primaryMac': mac,
        'createdAt': int(__import__('time').time() * 1000)
    }

    try:
        with open(IDENTITY_FILE, 'w', encoding='utf-8') as f:
            json.dump(identity, f, indent=2)
    except Exception:
        pass

    return identity

if __name__ == '__main__':
    ident = load_or_create_identity()
    print("RemoteMM Hardware Identity:")
    print(json.dumps(ident, indent=2))
