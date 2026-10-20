"""
RemoteMM Enterprise - Binary Network Framing Protocol (RMM2)
--------------------------------------------------------------
Implements Section 3.2 of the Enterprise Engineering Bible:
8-byte/12-byte binary framing to eliminate Base64 video streaming overhead,
prevent packet boundary fragmentation, and provide high-throughput zero-copy transfers.

Header Layout (12 bytes, Big-Endian):
0                   1                   2                   3
0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       MAGIC (0x524D4D32 = "RMM2")             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  PKT_TYPE (1B)| FLAGS (1B)    |      RESERVED (2B)            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       PAYLOAD_LENGTH (4B Big-Endian)          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       PAYLOAD_DATA (Variable Length)          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
"""

import struct
import json

MAGIC = b"RMM2"  # 0x524D4D32
HEADER_SIZE = 12
HEADER_FORMAT = ">4sBBHI"  # MAGIC(4), PKT_TYPE(1), FLAGS(1), RESERVED(2), PAYLOAD_LEN(4)

# Maximum payload size: 64 MB to prevent denial-of-service / buffer overflow
MAX_PAYLOAD_SIZE = 64 * 1024 * 1024

# Packet Type Constants (Section 3.2)
PKT_HANDSHAKE_REQ   = 0x01
PKT_HANDSHAKE_RESP  = 0x02
PKT_HEARTBEAT       = 0x03
PKT_SCREEN_FRAME    = 0x10
PKT_MOUSE_INPUT     = 0x11
PKT_KEYBOARD_INPUT  = 0x12
PKT_FILE_CHUNK      = 0x20
PKT_SYSTEM_ACTION   = 0x30
PKT_CHAT_MESSAGE    = 0x40
PKT_CLIPBOARD_SYNC  = 0x50
PKT_JSON_GENERIC    = 0x60

# Flags
FLAG_RAW            = 0x00
FLAG_COMPRESSED     = 0x01
FLAG_ENCRYPTED      = 0x02
FLAG_JSON           = 0x04

class RMM2ProtocolError(Exception):
    """Raised when an invalid RMM2 packet or framing error occurs."""
    pass

def is_rmm2_buffer(data: bytes) -> bool:
    """Checks whether the beginning of data contains the RMM2 magic header."""
    if not data or len(data) < 4:
        return False
    return data[:4] == MAGIC

def pack_rmm2_packet(pkt_type: int, payload: bytes | str | dict, flags: int = 0) -> bytes:
    """
    Packs a payload into an RMM2 binary network frame.
    If payload is a dictionary, it will be automatically serialized to UTF-8 JSON
    and the FLAG_JSON bit will be set.
    """
    if isinstance(payload, dict):
        payload_bytes = json.dumps(payload, separators=(',', ':')).encode('utf-8')
        flags |= FLAG_JSON
    elif isinstance(payload, str):
        payload_bytes = payload.encode('utf-8')
    elif isinstance(payload, (bytes, bytearray)):
        payload_bytes = bytes(payload)
    else:
        raise RMM2ProtocolError(f"Unsupported payload type: {type(payload)}")

    length = len(payload_bytes)
    if length > MAX_PAYLOAD_SIZE:
        raise RMM2ProtocolError(f"Payload size {length} exceeds maximum allowable {MAX_PAYLOAD_SIZE} bytes")

    header = struct.pack(HEADER_FORMAT, MAGIC, pkt_type & 0xFF, flags & 0xFF, 0, length)
    return header + payload_bytes

def unpack_rmm2_header(header_bytes: bytes) -> tuple[int, int, int]:
    """
    Validates and unpacks a 12-byte RMM2 header.
    Returns (pkt_type, flags, payload_length).
    """
    if len(header_bytes) < HEADER_SIZE:
        raise RMM2ProtocolError(f"Header too short: expected {HEADER_SIZE} bytes, got {len(header_bytes)}")

    magic, pkt_type, flags, _, length = struct.unpack(HEADER_FORMAT, header_bytes[:HEADER_SIZE])
    if magic != MAGIC:
        raise RMM2ProtocolError(f"Invalid RMM2 magic: {magic!r}")
    if length > MAX_PAYLOAD_SIZE:
        raise RMM2ProtocolError(f"Payload length {length} exceeds limit {MAX_PAYLOAD_SIZE}")

    return pkt_type, flags, length

class RMM2StreamParser:
    """
    Stateful TCP stream accumulator for streaming RMM2 packets.
    Handles partial chunks, packet boundaries, and yielding complete frames.
    """
    def __init__(self):
        self._buffer = bytearray()

    def feed(self, chunk: bytes) -> list[tuple[int, int, bytes]]:
        """
        Feeds incoming socket bytes into accumulator.
        Returns a list of complete (pkt_type, flags, payload_bytes) tuples.
        """
        if chunk:
            self._buffer.extend(chunk)

        packets = []
        while len(self._buffer) >= HEADER_SIZE:
            # Check magic signature
            if self._buffer[:4] != MAGIC:
                # Discard non-matching byte to resync on stream corruption
                self._buffer.pop(0)
                continue

            magic, pkt_type, flags, _, length = struct.unpack(HEADER_FORMAT, self._buffer[:HEADER_SIZE])
            if length > MAX_PAYLOAD_SIZE:
                # Corrupt stream, reset buffer
                self._buffer.clear()
                raise RMM2ProtocolError(f"Packet payload length overflow: {length}")

            total_needed = HEADER_SIZE + length
            if len(self._buffer) < total_needed:
                # Wait for remainder of payload
                break

            payload = bytes(self._buffer[HEADER_SIZE:total_needed])
            del self._buffer[:total_needed]
            packets.append((pkt_type, flags, payload))

        return packets

    @property
    def buffered_bytes_count(self) -> int:
        return len(self._buffer)

    def reset(self):
        self._buffer.clear()
