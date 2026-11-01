import { keccak256, stringToBytes, isHex } from 'viem';

export const ZERO_HASH = `0x${'0'.repeat(64)}` as const;

/** keccak256 of a UTF-8 text reference (an invoice number, tracking id, document URL). */
export function hashText(text: string): `0x${string}` {
  return keccak256(stringToBytes(text.trim()));
}

/** keccak256 of a file's bytes, computed in the browser. The file never leaves the device. */
export async function hashFile(file: File): Promise<`0x${string}`> {
  return keccak256(new Uint8Array(await file.arrayBuffer()));
}

export function isBytes32(value: string): value is `0x${string}` {
  return isHex(value, { strict: true }) && value.length === 66;
}

export function isZeroHash(value: string | undefined): boolean {
  return !value || value === ZERO_HASH;
}
