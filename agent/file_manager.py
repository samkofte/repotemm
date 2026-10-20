"""
RemoteMM Enterprise - Chunked File Transfer & Safe Path Manager
--------------------------------------------------------------
Implements 256 KB chunked streaming, SHA-256 integrity sealing,
and zero-trust path traversal protection against SAM/SYSTEM hives.
Adheres strictly to docs/ENTERPRISE_ENGINEERING_BIBLE.md Section 3.2 & 6.2.
"""

import os
import sys
import hashlib
import base64
import time
import tempfile
import threading

# Standard 256 KB chunk size (Section 3.2: 0x20 FILE_CHUNK)
CHUNK_SIZE = 256 * 1024  # 262,144 bytes

# Forbidden system paths for path traversal mitigation (Section 6.2)
SYSTEM_ROOT = os.environ.get('SystemRoot', 'C:\\Windows').lower()
FORBIDDEN_ROOTS = [
    os.path.join(SYSTEM_ROOT, 'system32', 'config').lower(),
    os.path.join(SYSTEM_ROOT, 'system32', 'drivers', 'etc').lower(),
    'c:\\windows\\system32\\config',
    'c:\\windows\\system32\\drivers\\etc'
]

FORBIDDEN_PATTERNS = [
    'system32\\config',
    'system32/config',
    'drivers\\etc',
    'drivers/etc'
]

def is_safe_path(target_path: str) -> bool:
    """
    Validates whether target_path is safe from directory traversal (Sam/System/etc).
    Canonicalizes path and checks against forbidden system roots.
    """
    if not target_path or not isinstance(target_path, str):
        return False

    clean_path = target_path.strip().strip('"').strip("'")
    if not clean_path:
        return False

    # Block alternate data streams (:zone.identifier, etc.)
    # Ignore drive colon (e.g. C:)
    drive, path_part = os.path.splitdrive(clean_path)
    if ':' in path_part:
        return False

    try:
        norm = os.path.normpath(clean_path).lower()
        abs_p = os.path.abspath(clean_path).lower()

        # Check against blocked roots
        for b in FORBIDDEN_ROOTS:
            if abs_p == b or abs_p.startswith(b + os.sep):
                return False

        # Check against forbidden string patterns
        for p in FORBIDDEN_PATTERNS:
            if p in norm or p in abs_p:
                return False

        return True
    except Exception:
        return False

class ChunkedUploadManager:
    """
    State machine managing 256 KB chunked uploads with SHA-256 integrity verification.
    Streams directly to a .part file; deletes immediately if hash tampering is detected.
    """
    def __init__(self):
        self._lock = threading.Lock()
        self._sessions = {}  # upload_id -> session info

    def start_upload(self, upload_id: str, target_path: str, total_chunks: int, total_size: int, expected_sha256: str = '') -> tuple[bool, str]:
        if not is_safe_path(target_path):
            return False, "ACCESS_DENIED_PATH_TRAVERSAL"

        with self._lock:
            # Prepare directory and part file
            abs_target = os.path.abspath(target_path)
            parent_dir = os.path.dirname(abs_target)
            if parent_dir and not os.path.exists(parent_dir):
                os.makedirs(parent_dir, exist_ok=True)

            part_file = abs_target + f".rmm_part_{int(time.time())}"
            try:
                # Open or create empty part file
                with open(part_file, 'wb') as f:
                    pass
            except Exception as e:
                return False, f"CREATE_PART_FILE_FAILED_{e}"

            self._sessions[upload_id] = {
                'upload_id': upload_id,
                'target_path': abs_target,
                'part_file': part_file,
                'total_chunks': total_chunks,
                'total_size': total_size,
                'expected_sha256': expected_sha256.lower().strip() if expected_sha256 else '',
                'received_chunks': set(),
                'bytes_written': 0,
                'created_at': time.time()
            }
            return True, "READY"

    def write_chunk(self, upload_id: str, chunk_index: int, chunk_bytes: bytes) -> tuple[bool, str, dict]:
        with self._lock:
            session = self._sessions.get(upload_id)
            if not session:
                return False, "UPLOAD_SESSION_NOT_FOUND", {}

            part_file = session['part_file']

        try:
            # Write chunk at exact offset
            offset = chunk_index * CHUNK_SIZE
            with open(part_file, 'r+b') as f:
                f.seek(offset)
                f.write(chunk_bytes)

            with self._lock:
                session['received_chunks'].add(chunk_index)
                session['bytes_written'] += len(chunk_bytes)
                received_count = len(session['received_chunks'])
                total_chunks = session['total_chunks']
                pct = round((received_count / max(1, total_chunks)) * 100, 1)

            meta = {
                'uploadId': upload_id,
                'chunkIndex': chunk_index,
                'totalChunks': total_chunks,
                'progressPercent': pct
            }
            return True, "CHUNK_OK", meta
        except Exception as e:
            return False, f"WRITE_CHUNK_FAILED_{e}", {}

    def finalize_upload(self, upload_id: str) -> tuple[bool, str, dict]:
        with self._lock:
            session = self._sessions.pop(upload_id, None)
            if not session:
                return False, "UPLOAD_SESSION_NOT_FOUND", {}

        part_file = session['part_file']
        target_path = session['target_path']
        expected_sha = session['expected_sha256']

        if not os.path.exists(part_file):
            return False, "PART_FILE_MISSING", {}

        # Calculate final SHA-256 hash
        hasher = hashlib.sha256()
        file_size = 0
        try:
            with open(part_file, 'rb') as f:
                while True:
                    b = f.read(65536)
                    if not b:
                        break
                    hasher.update(b)
                    file_size += len(b)
            actual_sha = hasher.hexdigest().lower()

            # Verify integrity
            if expected_sha and actual_sha != expected_sha:
                # Tamper detected! Delete partial file immediately (Section 6.2)
                try:
                    os.remove(part_file)
                except Exception:
                    pass
                return False, "TAMPER_DETECTED_SHA256_MISMATCH", {
                    'expectedSha256': expected_sha,
                    'actualSha256': actual_sha
                }

            # Atomically replace destination
            if os.path.exists(target_path):
                os.remove(target_path)
            os.replace(part_file, target_path)

            return True, "SUCCESS", {
                'path': target_path,
                'size': file_size,
                'sha256': actual_sha
            }
        except Exception as e:
            if os.path.exists(part_file):
                try: os.remove(part_file)
                except Exception: pass
            return False, f"FINALIZE_ERROR_{e}", {}

    def abort_upload(self, upload_id: str) -> bool:
        with self._lock:
            session = self._sessions.pop(upload_id, None)
            if not session:
                return False
        part = session.get('part_file')
        if part and os.path.exists(part):
            try: os.remove(part)
            except Exception: pass
        return True

def get_file_metadata_for_download(source_path: str) -> tuple[bool, str, dict]:
    """
    Prepares a file for 256 KB chunked download.
    Checks path safety, calculates total size, total chunks, and SHA-256.
    """
    if not is_safe_path(source_path):
        return False, "ACCESS_DENIED_PATH_TRAVERSAL", {}

    abs_source = os.path.abspath(source_path)
    if not os.path.exists(abs_source) or not os.path.isfile(abs_source):
        return False, "FILE_NOT_FOUND", {}

    try:
        size = os.path.getsize(abs_source)
        total_chunks = max(1, (size + CHUNK_SIZE - 1) // CHUNK_SIZE) if size > 0 else 1

        hasher = hashlib.sha256()
        with open(abs_source, 'rb') as f:
            while True:
                b = f.read(65536)
                if not b:
                    break
                hasher.update(b)
        sha256_hex = hasher.hexdigest().lower()

        return True, "READY", {
            'path': abs_source,
            'filename': os.path.basename(abs_source),
            'totalSize': size,
            'chunkSize': CHUNK_SIZE,
            'totalChunks': total_chunks,
            'sha256': sha256_hex
        }
    except Exception as e:
        return False, f"METADATA_ERROR_{e}", {}

def read_file_chunk(source_path: str, chunk_index: int, chunk_size: int = CHUNK_SIZE) -> tuple[bool, bytes, str]:
    """Reads a single 256 KB slice of a file without keeping the full file in RAM."""
    if not is_safe_path(source_path):
        return False, b'', "ACCESS_DENIED_PATH_TRAVERSAL"

    try:
        with open(source_path, 'rb') as f:
            f.seek(chunk_index * chunk_size)
            chunk = f.read(chunk_size)
            return True, chunk, "OK"
    except Exception as e:
        return False, b'', str(e)

# Global chunked upload manager instance
upload_manager = ChunkedUploadManager()
