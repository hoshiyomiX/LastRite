import { arrayBufferToHex } from '../utils/helpers.js';
import { PROTOCOL_HORSE, PROTOCOL_FLASH, UUID_V4_REGEX } from '../config/constants.js';

export function protocolSniffer(buffer) {
  if (buffer.byteLength >= 62) {
    const horseDelimiter = new Uint8Array(buffer.slice(56, 60));
    if (horseDelimiter[0] === 0x0d && horseDelimiter[1] === 0x0a) {
      if (horseDelimiter[2] === 0x01 || horseDelimiter[2] === 0x03 || horseDelimiter[2] === 0x7f) {
        if (horseDelimiter[3] === 0x01 || horseDelimiter[3] === 0x03 || horseDelimiter[3] === 0x04) {
          return PROTOCOL_HORSE;
        }
      }
    }
  }

  const flashDelimiter = new Uint8Array(buffer.slice(1, 17));
  if (UUID_V4_REGEX.test(arrayBufferToHex(flashDelimiter))) {
    return PROTOCOL_FLASH;
  }

  return "ss";
}
