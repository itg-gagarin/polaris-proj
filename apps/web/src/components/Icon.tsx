const P: Record<string, string> = {
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5a1.5 1.5 0 0 1 3 0V12m0-5a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 14a1.5 1.5 0 0 1 2.5-1.7L8 15',
  select: 'M5 3l14 8-6 2-2 6z',
  rect: 'M4 5h16v14H4z',
  diamond: 'M12 3l9 9-9 9-9-9z',
  ellipse: 'M12 5c4.97 0 9 3.13 9 7s-4.03 7-9 7-9-3.13-9-7 4.03-7 9-7z',
  arrow: 'M5 19L19 5M10 5h9v9',
  line: 'M5 19L19 5',
  pencil: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  note: 'M5 4h14v11l-5 5H5zM14 20v-5h5',
  eraser: 'M8 20h12M5 15l9-9 5 5-9 9H8z',
  more: 'M12 5h.01M12 12h.01M12 19h.01',
  move: 'M12 3v18M3 12h18M12 3l-3 3m3-3l3 3M12 21l-3-3m3 3l3-3M3 12l3-3m-3 3l3 3M21 12l-3-3m3 3l-3 3',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  resize: 'M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7',
  measure: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  dimension: 'M4 7v10M20 7v10M4 12h16M8 9l-4 3 4 3M16 9l4 3-4 3',
  section: 'M4 4l16 16M4 20h16V4',
  explode: 'M12 2v5M12 17v5M2 12h5M17 12h5M9 9h6v6H9z',
  addPart: 'M12 5v14M5 12h14',
  laser: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 2v3M12 19v3M2 12h3M19 12h3',
  frame: 'M3 7h18M7 3v18M3 17h18M17 3v18',
};

export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? P.more} />
    </svg>
  );
}
