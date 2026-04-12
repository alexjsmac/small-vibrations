export interface Track {
  id: string;
  side: 'A' | 'B';
  n: number;
  title: string;
  /** Path of the viz module relative to /src/viz, loaded dynamically. */
  viz: string;
}

export const ALBUM = {
  artist: 'Sunntack',
  title: 'Small Vibrations',
  catalog: 'SUN001',
};

export const TRACKS: Track[] = [
  { id: 'a1', side: 'A', n: 1, title: 'Biome Dominoes',           viz: 'placeholder' },
  { id: 'a2', side: 'A', n: 2, title: 'Marching Under Foot',      viz: 'placeholder' },
  { id: 'a3', side: 'A', n: 3, title: 'Without bee, without me',  viz: 'placeholder' },
  { id: 'b1', side: 'B', n: 1, title: 'Hidden Collateral',        viz: 'placeholder' },
  { id: 'b2', side: 'B', n: 2, title: 'Sticky, slimy, and thriving', viz: 'placeholder' },
  { id: 'b3', side: 'B', n: 3, title: 'Sterile Earth',            viz: 'placeholder' },
];
