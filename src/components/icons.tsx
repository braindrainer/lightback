// Strich-Icons (24er Raster, 1.8 px), immer dekorativ – Text steht daneben oder im aria-label des Knopfs
const P: Record<string, string> = {
  mehr: 'M5 12h.01M12 12h.01M19 12h.01',
  haken: 'M5 12.5l4.5 4.5L19 7',
  kopieren: 'M9 9h10v11H9zM5 15V4h10',
  x: 'M6 6l12 12M18 6L6 18',
  warnung: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  info: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 11v5M12 8h.01',
  extern: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  plus: 'M12 5v14M5 12h14',
  suche: 'M11 18a7 7 0 110-14 7 7 0 010 14zM20 20l-4-4',
  ticket: 'M4 7h16v3a2 2 0 000 4v3H4v-3a2 2 0 000-4zM14 7v10',
  gutschein: 'M3 8h18v4a2 2 0 000 4v4H3v-4a2 2 0 000-4zM12 8v12M12 8c-1-3-5-4-5-1.5S12 8 12 8zm0 0c1-3 5-4 5-1.5S12 8 12 8',
  mail: 'M3 6h18v12H3zM3 6l9 7 9-7',
  kalender: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4',
  kunde: 'M16 19a4 4 0 00-8 0M12 11a3 3 0 100-6 3 3 0 000 6',
  kunden: 'M15 19a4 4 0 00-8 0M11 11a3 3 0 100-6 3 3 0 000 6M21 19a4 4 0 00-3-3.9M16 5.1a3 3 0 010 5.8',
  rechnung: 'M7 3h10v18l-3-2-2 2-2-2-3 2zM9 8h6M9 12h6',
  zahlung: 'M3 6h18v12H3zM3 10h18M7 15h3',
  druck: 'M7 9V3h10v6M7 17H4v-8h16v8h-3M7 14h10v7H7z',
  bearbeiten: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  storno: 'M12 21a9 9 0 110-18 9 9 0 010 18zM6 6l12 12',
  umbuchen: 'M4 8h13l-3-3M20 16H7l3 3',
  pfeil: 'M5 12h14M13 6l6 6-6 6',
  zurueck: 'M19 12H5M11 6l-6 6 6 6',
  chevron: 'M9 6l6 6-6 6',
  runter: 'M6 9l6 6 6-6',
  uhr: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 7v5l3 2',
  schloss: 'M6 11h12v10H6zM8 11V8a4 4 0 018 0v3',
  scan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10',
  login: 'M10 17l5-5-5-5M15 12H3M14 4h6v16h-6',
  notiz: 'M5 4h14v12l-4 4H5zM15 20v-4h4M9 9h6M9 13h4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  telefon: 'M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2',
  web: 'M12 21a9 9 0 110-18 9 9 0 010 18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  partner: 'M8 12h8M12 8v8M4 4h16v16H4z',
  stern: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.1 9.5l6.1-.9z',
  euro: 'M17 6.5A7 7 0 0010 18a7 7 0 007-.5M5 10h9M5 14h9',
  sitz: 'M7 12V6a2 2 0 012-2h6a2 2 0 012 2v6M5 12h14v4H5zM7 16v4M17 16v4',
  einstellungen: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-2V4h-4v2L9 7 7 6 5 10l2 1v2l-2 1 2 4 2-1 2 2v2h4v-2l2-2 2 1 2-4-2-1z',
  ordner: 'M3 6h6l2 2h10v11H3z',
  liste: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  diagramm: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  buch: 'M4 4h16v16H4zM4 9h16M9 9v11',
  schild: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z',
  aktualisieren: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
};

export const ICON_NAMEN = Object.keys(P);

export function Icon({ name, className = 'h-[18px] w-[18px]' }: { name: string; className?: string }) {
  const d = P[name] ?? name;
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={name === 'mehr' ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  );
}
