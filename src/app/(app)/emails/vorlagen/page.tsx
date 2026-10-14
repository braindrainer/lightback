import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { STANDARD_VORLAGEN } from '@/lib/mail';
import { PageHeader } from '@/components/ui';
import { Editor } from './Editor';
import { PLATZHALTER, VORLAGE_NAME } from './platzhalter';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'E-Mail-Vorlagen' };

export default async function Vorlagen() {
  await requireRole('leitung');
  const eigene = new Map((await db.emailTemplate.findMany()).map((t) => [t.key, t]));
  return (
    <>
      <PageHeader krumen={[{ label: 'System' }, { label: 'E-Mails', href: '/emails' }, { label: 'Vorlagen' }]} title="E-Mail-Vorlagen" sub="Texte der automatischen Mails. Platzhalter in doppelten geschweiften Klammern werden beim Versand ersetzt.">
        <Link href="/emails" className="btn-secondary">Zum Mail-Protokoll</Link>
      </PageHeader>
      <div className="grid gap-6">
        {Object.entries(STANDARD_VORLAGEN).map(([k, std]) => {
          const e = eigene.get(k);
          return (
            <section key={k} aria-labelledby={`v-${k}`} className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`v-${k}`} className="h2">{VORLAGE_NAME[k] ?? k} <span className="font-mono text-xs font-normal text-muted">{k}</span></h2>
                <p className="text-xs text-muted">{e ? `Eigener Text, geändert ${fmtDatumZeit(e.updatedAt)}` : 'Standardtext'}</p>
              </div>
              <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_16rem]">
                <Editor k={k} subject={e?.subject ?? std.subject} body={e?.body ?? std.body} standard={std} angepasst={!!e} />
                <aside aria-label={`Platzhalter für ${VORLAGE_NAME[k]}`} className="text-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Platzhalter</h3>
                  <dl className="mt-2 grid gap-1.5">
                    {(PLATZHALTER[k] ?? []).map(([p, t]) => <div key={p}><dt className="font-mono text-[12.5px]">{`{{${p}}}`}</dt><dd className="text-xs text-muted">{t}</dd></div>)}
                  </dl>
                  <p className="mt-3 text-xs text-muted">Werte werden automatisch maskiert; nur Platzhalter, die auf <code>_html</code> enden, fügen fertiges HTML ein.</p>
                </aside>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
