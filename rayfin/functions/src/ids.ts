/**
 * Deterministički identifikatori (UUID v5, RFC 4122) da bi upsert bio idempotentan:
 * ista stanica / isti dan / isti polutant uvek dobija isti `id`.
 */
import { createHash } from 'node:crypto';

/** Namespace aplikacije Vazduh Srbije (proizvoljan, fiksan UUID). */
export const VAZDUH_NAMESPACE = '3f2b7a9e-5c1d-4e8a-9b6f-1d2c3e4f5a6b';

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

export function uuidV5(name: string, namespace: string = VAZDUH_NAMESPACE): string {
  const hash = createHash('sha1');
  hash.update(uuidToBytes(namespace));
  hash.update(Buffer.from(name, 'utf8'));
  const bytes = hash.digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // verzija 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // varijanta RFC 4122
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const stationId = (sepaId: number): string => uuidV5(`station|${sepaId}`);
export const snapshotId = (sepaId: number): string => uuidV5(`snapshot|${sepaId}`);
export const dailyStatId = (sepaId: number, parameter: string, day: string): string =>
  uuidV5(`daily|${sepaId}|${parameter}|${day}`);
