export interface Track {
  id: string;
  side: 'A' | 'B';
  n: number;
  title: string;
  /** Path of the viz module relative to /src/viz, loaded dynamically. */
  viz: string;
  /** Seconds, from the individual track masters (afinfo) — used for the fallback song clock. */
  duration: number;
}

export const ALBUM = {
  artist: 'Sunntack',
  title: 'Small Vibrations',
  catalog: 'SUN001',
};

export const TRACKS: Track[] = [
  { id: 'a1', side: 'A', n: 1, title: 'They Come Marching',        viz: 'a1-they-come-marching', duration: 286.439 },
  { id: 'a2', side: 'A', n: 2, title: 'Homemakers',                viz: 'placeholder',            duration: 294.124 },
  { id: 'a3', side: 'A', n: 3, title: 'Biome Dominoes',            viz: 'placeholder',            duration: 259.835 },
  { id: 'b1', side: 'B', n: 1, title: 'Icky, Sticky, & Thriving',  viz: 'placeholder',            duration: 251.238 },
  { id: 'b2', side: 'B', n: 2, title: 'Terminal Taxonomy',         viz: 'placeholder',            duration: 336.998 },
  { id: 'b3', side: 'B', n: 3, title: 'Sterile Breath',            viz: 'placeholder',            duration: 200.042 },
];
