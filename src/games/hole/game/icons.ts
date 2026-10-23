/** Menu and HUD icons: small inline SVGs (20 x 20 grid, filled with currentColor) so they look the same on every OS. */
const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  play: ['M5 3.5v13l11-6.5z'],
  pause: [
    'M4.5 3h3.8a.7.7 0 0 1 .7.7v12.6a.7.7 0 0 1-.7.7H4.5a.7.7 0 0 1-.7-.7V3.7a.7.7 0 0 1 .7-.7z',
    'M11.7 3h3.8a.7.7 0 0 1 .7.7v12.6a.7.7 0 0 1-.7.7h-3.8a.7.7 0 0 1-.7-.7V3.7a.7.7 0 0 1 .7-.7z',
  ],
  back: ['M12.8 3.2 6 10l6.8 6.8 1.9-1.9L9.8 10l4.9-4.9z'],
  next: ['M7.2 3.2 14 10l-6.8 6.8-1.9-1.9L10.2 10 5.3 5.1z'],
  check: ['M7.6 15.4 2.6 10.4l1.9-1.9 3.1 3.1 7.9-7.9 1.9 1.9z'],
  dice: [
    'M5.5 2.5h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1z',
    'M6.8 5.8a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zm6.4 0a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM10 8.8a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zm-3.2 3a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zm6.4 0a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z',
  ],
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'currentColor');
  for (const d of PATHS[name]) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
