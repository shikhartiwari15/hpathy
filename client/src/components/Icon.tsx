import type { SVGProps } from 'react';

// Minimal stroke icon set (currentColor). Keeps the UI free of emoji.
const PATHS: Record<string, JSX.Element> = {
  home: <><path d="M3 10 12 3l9 7" /><path d="M5 9v11h14V9" /></>,
  box: <><path d="M12 2 3 7v10l9 5 9-5V7z" /><path d="M3 7l9 5 9-5" /><path d="M12 12v10" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  sliders: <><path d="M5 21v-6" /><path d="M5 11V3" /><path d="M12 21v-9" /><path d="M12 8V3" /><path d="M19 21v-5" /><path d="M19 12V3" /><path d="M2 15h6" /><path d="M9 8h6" /><path d="M16 16h6" /></>,
  search: <><circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.3-4.3" /></>,
  download: <><path d="M12 3v11" /><path d="m8 11 4 4 4-4" /><path d="M4 21h16" /></>,
  upload: <><path d="M12 21V10" /><path d="m8 14 4-4 4 4" /><path d="M4 3h16" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m6 6 1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 9v5" /><path d="M12 17h.01" /></>,
  leaf: <><path d="M4 20C4 10 11 4 20 4c0 9-6 16-16 16z" /><path d="M4 20 13 11" /></>,
  moon: <path d="M21 12.8A8 8 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  camera: <><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13.5" r="3.5" /></>,
};

export default function Icon({ name, size = 20, ...rest }: { name: keyof typeof PATHS | string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {PATHS[name] ?? null}
    </svg>
  );
}
