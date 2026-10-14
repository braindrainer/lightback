'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

// Am Handy scrollen breite Tabellen in Karten seitlich. Solche Bereiche müssen per Tastatur
// erreichbar und benannt sein (WCAG 2.1.1) – hier automatisch für alle Seiten.
export default function ScrollBereiche() {
  const pfad = usePathname();
  useEffect(() => {
    const pruefen = () => {
      document.querySelectorAll<HTMLElement>('main .card').forEach((el) => {
        const scrollt = el.scrollWidth > el.clientWidth + 1;
        if (scrollt && !el.hasAttribute('tabindex')) {
          el.tabIndex = 0;
          el.dataset.scrollAuto = '1';
          if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
            const h = el.querySelector('h2, h3, caption');
            el.setAttribute('role', el.getAttribute('role') ?? 'region');
            el.setAttribute('aria-label', h?.textContent?.trim() || 'Tabelle, seitlich scrollbar');
          }
        } else if (!scrollt && el.dataset.scrollAuto) {
          el.removeAttribute('tabindex');
          delete el.dataset.scrollAuto;
        }
      });
    };
    pruefen();
    const t = setTimeout(pruefen, 500);
    window.addEventListener('resize', pruefen);
    return () => { clearTimeout(t); window.removeEventListener('resize', pruefen); };
  }, [pfad]);
  return null;
}
