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
  { id: 'a1', side: 'A', n: 1, title: 'They Come Marching',        viz: 'placeholder' },
  { id: 'a2', side: 'A', n: 2, title: 'Homemakers',                viz: 'placeholder' },
  { id: 'a3', side: 'A', n: 3, title: 'Biome Dominoes',            viz: 'placeholder' },
  { id: 'b1', side: 'B', n: 1, title: 'Icky, Sticky, & Thriving',  viz: 'placeholder' },
  { id: 'b2', side: 'B', n: 2, title: 'Terminal Taxonomy',         viz: 'placeholder' },
  { id: 'b3', side: 'B', n: 3, title: 'Sterile Breath',            viz: 'placeholder' },
];
