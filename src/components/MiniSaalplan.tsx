// Kleiner, nicht bedienbarer Saalplan (Server-SVG): markiert einen Platz, z. B. auf der Ticketseite und am Druckticket.
import { SITZE, SITZ, sitzName, type Sitz } from '@/lib/saal';

const KX = 2.15;
const KY = 1.65;
const px = (x: number) => (x - 262) * KX;
const py = (y: number) => (y - 90) * KY;
const BREITE = px(590);
const HOEHE = py(925);
const pos = (s: Sitz) => (s.reihe === 0 ? { x: s.x, y: s.rollstuhl ? 192 : 175 } : { x: s.x, y: s.y });

export default function MiniSaalplan({ seatId, className = '' }: { seatId: string; className?: string }) {
  const ziel = SITZ[seatId];
  const zp = ziel ? pos(ziel) : null;
  return (
    <svg viewBox={`-20 -30 ${BREITE + 40} ${HOEHE + 50}`} role="img" aria-label={`Saalplan der Votivkirche, Altar oben. Markiert: ${sitzName(seatId)}`} className={className}>
      <rect x={px(360)} y={py(142) - 15} width={px(470) - px(360)} height={30} rx={10} fill="#f6ecd4" stroke="#8a6a1f" />
      <text x={(px(360) + px(470)) / 2} y={py(142) + 5} textAnchor="middle" fontSize={16} fontWeight={600} fill="#6e5118">ALTAR</text>
      {SITZE.filter((s) => s.id !== seatId && !s.rollstuhl).map((s) => {
        const p = pos(s);
        return <circle key={s.id} cx={px(p.x)} cy={py(p.y)} r={5} fill={s.kat === 'II' ? '#d6d0f5' : '#e8dcc0'} />;
      })}
      {SITZE.filter((s) => s.rollstuhl && s.id !== seatId).map((s) => {
        const p = pos(s);
        return <rect key={s.id} x={px(p.x) - 8} y={py(p.y) - 6} width={16} height={12} rx={3} fill="#cfe0f0" />;
      })}
      {zp && (
        <g>
          <circle cx={px(zp.x)} cy={py(zp.y)} r={22} fill="none" stroke="#b3261e" strokeWidth={5} />
          <circle cx={px(zp.x)} cy={py(zp.y)} r={10} fill="#121a2b" />
          <line x1={px(zp.x)} y1={py(zp.y) - 22} x2={px(zp.x)} y2={py(zp.y) - 60} stroke="#b3261e" strokeWidth={5} />
        </g>
      )}
    </svg>
  );
}
