import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKS, LISTENING_TRACK, ALBUM } from './tracks';

const vizDir = join(dirname(fileURLToPath(import.meta.url)), 'viz');

describe('TRACKS', () => {
  it('has exactly 6 tracks', () => {
    expect(TRACKS).toHaveLength(6);
  });

  it('has unique ids', () => {
    const ids = TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has positive, finite durations', () => {
    for (const t of TRACKS) {
      expect(Number.isFinite(t.duration)).toBe(true);
      expect(t.duration).toBeGreaterThan(0);
    }
  });

  it('has an on-disk viz module for every track', () => {
    for (const t of TRACKS) {
      const indexPath = join(vizDir, t.viz, 'index.ts');
      expect(existsSync(indexPath), `missing src/viz/${t.viz}/index.ts for track ${t.id}`).toBe(true);
    }
  });

  it('has valid side/n values', () => {
    for (const t of TRACKS) {
      expect(['A', 'B']).toContain(t.side);
      expect(t.n).toBeGreaterThan(0);
    }
  });
});

describe('LISTENING_TRACK', () => {
  it('has the expected shape and is not part of TRACKS', () => {
    expect(LISTENING_TRACK.id).toBe('listening');
    expect(LISTENING_TRACK.duration).toBeGreaterThan(0);
    expect(TRACKS.find((t) => t.id === LISTENING_TRACK.id)).toBeUndefined();
  });

  it('has an on-disk viz module', () => {
    const indexPath = join(vizDir, LISTENING_TRACK.viz, 'index.ts');
    expect(existsSync(indexPath)).toBe(true);
  });
});

describe('ALBUM', () => {
  it('has the expected metadata fields', () => {
    expect(ALBUM.artist).toBeTruthy();
    expect(ALBUM.title).toBeTruthy();
    expect(ALBUM.catalog).toBeTruthy();
  });
});
