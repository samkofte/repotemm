/**
 * RemoteMM Enterprise - Binary Network Framing Protocol (RMM2) Node.js Codec
 * ---------------------------------------------------------------------------
 * Implements Section 3.2 of the Enterprise Engineering Bible.
 * Provides high-performance binary framing for streaming JPEG video frames,
 * encrypted file chunks, and zero-copy packet transmission between Gateway and Agents.
 */

export const MAGIC = Buffer.from('RMM2', 'ascii'); // 0x524D4D32
export const HEADER_SIZE = 12;
export const MAX_PAYLOAD_SIZE = 64 * 1024 * 1024; // 64 MB

// Packet Types (Section 3.2)
export const PKT_HANDSHAKE_REQ   = 0x01;
export const PKT_HANDSHAKE_RESP  = 0x02;
export const PKT_HEARTBEAT       = 0x03;
export const PKT_SCREEN_FRAME    = 0x10;
export const PKT_MOUSE_INPUT     = 0x11;
export const PKT_KEYBOARD_INPUT  = 0x12;
export const PKT_FILE_CHUNK      = 0x20;
export const PKT_SYSTEM_ACTION   = 0x30;
export const PKT_CHAT_MESSAGE    = 0x40;
export const PKT_CLIPBOARD_SYNC  = 0x50;
export const PKT_JSON_GENERIC    = 0x60;

// Flags
export const FLAG_RAW            = 0x00;
export const FLAG_COMPRESSED     = 0x01;
export const FLAG_ENCRYPTED      = 0x02;
export const FLAG_JSON           = 0x04;

/**
 * Checks if buffer starts with RMM2 magic header
 * @param {Buffer} buf 
 * @returns {boolean}
 */
export function isRMM2Buffer(buf) {
  if (!buf || buf.length < 4) return false;
  return buf[0] === 0x52 && buf[1] === 0x4D && buf[2] === 0x4D && buf[3] === 0x32;
}

/**
 * Encodes an RMM2 binary network frame.
 * @param {number} pktType - One of PKT_* constants
 * @param {Buffer|string|object} payload - Raw buffer, string or JS object
 * @param {number} flags - Bitmask of FLAG_*
 * @returns {Buffer}
 */
export function encodeRMM2(pktType, payload, flags = 0) {
  let payloadBuf;
  let activeFlags = flags;

  if (Buffer.isBuffer(payload)) {
    payloadBuf = payload;
  } else if (typeof payload === 'object' && payload !== null) {
    payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
    activeFlags |= FLAG_JSON;
  } else if (typeof payload === 'string') {
    payloadBuf = Buffer.from(payload, 'utf8');
  } else {
    throw new TypeError(`Unsupported payload type for RMM2: ${typeof payload}`);
  }

  if (payloadBuf.length > MAX_PAYLOAD_SIZE) {
    throw new RangeError(`Payload size ${payloadBuf.length} exceeds max allowable ${MAX_PAYLOAD_SIZE} bytes`);
  }

  const header = Buffer.allocUnsafe(HEADER_SIZE);
  MAGIC.copy(header, 0, 0, 4);
  header.writeUInt8(pktType & 0xFF, 4);
  header.writeUInt8(activeFlags & 0xFF, 5);
  header.writeUInt16BE(0, 6); // Reserved
  header.writeUInt32BE(payloadBuf.length, 8);

  return Buffer.concat([header, payloadBuf]);
}

/**
 * Unpacks and validates a 12-byte RMM2 header.
 * @param {Buffer} buf 
 * @returns {{ pktType: number, flags: number, payloadLength: number }}
 */
export function decodeRMM2Header(buf) {
  if (!buf || buf.length < HEADER_SIZE) {
    throw new Error(`Buffer too short for RMM2 header: ${buf?.length || 0} bytes`);
  }
  if (!isRMM2Buffer(buf)) {
    throw new Error(`Invalid RMM2 magic identifier`);
  }

  const pktType = buf.readUInt8(4);
  const flags = buf.readUInt8(5);
  const payloadLength = buf.readUInt32BE(8);

  if (payloadLength > MAX_PAYLOAD_SIZE) {
    throw new RangeError(`Payload length ${payloadLength} exceeds limit ${MAX_PAYLOAD_SIZE}`);
  }

  return { pktType, flags, payloadLength };
}

/**
 * Stateful stream parser that accumulates incoming TCP/WebSocket data chunks
 * and produces complete RMM2 packets.
 */
export class RMM2StreamParser {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Feeds a chunk of data into parser and returns array of complete packets.
   * @param {Buffer} chunk 
   * @returns {Array<{ pktType: number, flags: number, payload: Buffer }>}
   */
  feed(chunk) {
    if (chunk && chunk.length > 0) {
      this.buffer = Buffer.concat([this.buffer, chunk]);
    }

    const packets = [];

    while (this.buffer.length >= HEADER_SIZE) {
      // Find magic header
      if (!isRMM2Buffer(this.buffer)) {
        // Discard 1 byte until magic found to resync stream
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      const { pktType, flags, payloadLength } = decodeRMM2Header(this.buffer);
      const totalNeeded = HEADER_SIZE + payloadLength;

      if (this.buffer.length < totalNeeded) {
        // Incomplete packet; wait for next chunk
        break;
      }

      const payload = this.buffer.subarray(HEADER_SIZE, totalNeeded);
      this.buffer = this.buffer.subarray(totalNeeded);

      packets.push({ pktType, flags, payload });
    }

    return packets;
  }

  get bufferedBytesCount() {
    return this.buffer.length;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }
}
