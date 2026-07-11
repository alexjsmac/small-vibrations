/**
 * Sanity checks against the real committed fingerprint DB
 * (public/fp/db.bin + manifest.json). These guard the invariants the
 * in-browser matcher depends on — if a future `npm run fingerprints`
 * regeneration breaks one of these, matching silently degrades in
 * production rather than failing loudly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserializeDB, VALUE_FRAME_BITS, type TrackEntry } from './dsp';
import { TRACKS } from '../tracks';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fpDir = join(repoRoot, 'public', 'fp');

interface Manifest { version: number; count: number; tracks: TrackEntry[] }

const manifest: Manifest = JSON.parse(readFileSync(join(fpDir, 'manifest.json'), 'utf8'));
const dbBytes = readFileSync(join(fpDir, 'db.bin'));
const dbBuffer = dbBytes.buffer.slice(dbBytes.byteOffset, dbBytes.byteOffset + dbBytes.byteLength);

describe('fixture fingerprint DB (public/fp)', () => {
  it('deserializes successfully against the manifest track list', () => {
    expect(() => deserializeDB(dbBuffer, manifest.tracks)).not.toThrow();
  });

  it('has hashes.length matching manifest.count', () => {
    const db = deserializeDB(dbBuffer, manifest.tracks);
    expect(db.hashes.length).toBe(manifest.count);
  });

  it('has the exact expected byte length', () => {
    expect(dbBytes.byteLength).toBe(16 + manifest.count * 8);
  });

  it('has 6 tracks matching manifest ids AND TRACKS ids, in order', () => {
    expect(manifest.tracks).toHaveLength(6);
    expect(manifest.tracks.map((t) => t.id)).toEqual(TRACKS.map((t) => t.id));
  });

  it('has hashes sorted ascending (the invariant queryDB\'s binary search needs)', () => {
    const db = deserializeDB(dbBuffer, manifest.tracks);
    for (let i = 1; i < db.hashes.length; i++) {
      expect(db.hashes[i]).toBeGreaterThanOrEqual(db.hashes[i - 1]);
    }
  });

  it('has every value\'s frame within that track\'s manifest frame count', () => {
    const db = deserializeDB(dbBuffer, manifest.tracks);
    const frameMask = (1 << VALUE_FRAME_BITS) - 1;
    for (let i = 0; i < db.values.length; i++) {
      const trackIndex = db.values[i] >>> VALUE_FRAME_BITS;
      const frame = db.values[i] & frameMask;
      expect(trackIndex).toBeLessThan(manifest.tracks.length);
      expect(frame).toBeLessThanOrEqual(manifest.tracks[trackIndex].frames);
    }
  });
});
