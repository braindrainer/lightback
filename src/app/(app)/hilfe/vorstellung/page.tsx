// Hilfe für das Team: was bei einer Vorstellung passieren kann und wo man klickt
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'Hilfe: rund um die Vorstellung' };

const FAELLE: { id: string; titel: string; wer: string; schritte: React.ReactNode[] }[] = [
  {
    id: 'gaeste', titel: 'Freikarten und Gästeliste', wer: 'Leitung',
    schritte: [
      <>Vorstellung öffnen → <strong>Gästeliste (Freikarten)</strong>.</>,
      <>Name, Anzahl und Kategorie eintragen – oder „Plätze im Saalplan wählen“. Grund wählen (Presse, Sponsor …).</>,
      <>Zustellung: <strong>Per E-Mail</strong> (der Gast bekommt die Tickets mit QR-Code) und/oder <strong>an der Kassa hinterlegt</strong>.</>,
      <>Viele Gäste auf einmal: unter „Liste importieren“ Zeilen im Format <code>Name;E-Mail;Anzahl;Grund</code> einfügen.</>,
      <>Kontingent: optional eine Höchstzahl an Freikarten je Vorstellung. Wird sie überschritten, erscheint ein Hinweis.</>,
      <>Für Kassa und Eingang: <strong>Liste drucken (A4)</strong> – mit Kästchen für hinterlegt, abgeholt, eingelassen.</>,
      <>Freikarten kosten 0 €: Es gibt keine Rechnung und keine Buchung.</>,
    ],
  },
  {
    id: 'abholen', titel: 'Hinterlegte Karten an der Kassa abholen', wer: 'Kassa',
    schritte: [
      <>Kassa → <strong>Gäste &amp; Tickets</strong>. Unten stehen alle hinterlegten Gäste der Vorstellung.</>,
      <>Oder nach Name, Firma oder Buchungsnummer suchen.</>,
      <><strong>Ausgeben</strong> drucken: Die Karten kommen mit QR-Code aus dem Bondrucker. Es entsteht kein Kassabeleg, weil nichts verkauft wird.</>,
      <>Nochmal drucken geht jederzeit („Nachdruck“) – das wird protokolliert.</>,
    ],
  },
  {
    id: 'name', titel: 'Gast hat kein Ticket dabei (Handy vergessen, Akku leer)', wer: 'Einlass',
    schritte: [
      <>Im Scanner unten auf <strong>Name</strong> tippen.</>,
      <>Nach Name, E-Mail, Firma, Buchungsnummer oder Ticketcode suchen.</>,
      <>Bei der richtigen Buchung <strong>Einlassen</strong> tippen – oder <strong>Alle einlassen</strong> bei Gruppen und Schulklassen.</>,
      <>Im Zweifel einen Ausweis zeigen lassen. Jeder Einlass ohne Scan ist im Protokoll vermerkt.</>,
    ],
  },
  {
    id: 'verweigern', titel: 'Einlass verweigern', wer: 'Einlass',
    schritte: [
      <>Nach dem Scan auf dem Ergebnis-Bildschirm <strong>Einlass verweigern</strong> tippen (oder in der Namenssuche „Verweigern“).</>,
      <>Grund wählen: Kind unter 6 Jahren, Alkohol oder Drogen (laut AGB), Hausverbot, Ermäßigung ohne Nachweis, Sonstiges.</>,
      <>Das Ticket bleibt gültig. Ein eben erfolgter Einlass wird zurückgenommen.</>,
      <>Ermäßigung ohne Nachweis: Gast zur Kassa schicken. Dort unter <strong>Gäste &amp; Tickets → Umsetzen / Aufzahlen</strong> den Tarif auf Vollpreis stellen und den Unterschied kassieren. Danach erneut scannen.</>,
    ],
  },
  {
    id: 'spaet', titel: 'Gast kommt zu spät', wer: 'Einlass',
    schritte: [
      <>Ganz normal scannen. Läuft die Vorstellung schon, zeigt der grüne Bildschirm „Vorstellung läuft seit … Min.“.</>,
      <>Den Gast leise zum Platz begleiten oder – je nach Hausregel – bis zu einer passenden Pause warten lassen.</>,
    ],
  },
  {
    id: 'falsch', titel: 'Ticket für eine andere Vorstellung', wer: 'Einlass, Leitung',
    schritte: [
      <>Der Scanner zeigt rot „Falsche Vorstellung“ und die richtige Uhrzeit.</>,
      <>Sind Plätze frei, tippen Sie <strong>Auf diese Vorstellung umbuchen</strong> und bestätigen. Das alte Ticket wird storniert, ein neues in derselben Kategorie ausgestellt und der Gast gleich eingelassen.</>,
      <>Ist die jetzige Vorstellung teurer, geht das nur an der Kassa.</>,
    ],
  },
  {
    id: 'umsetzen', titel: 'Gast umsetzen (anderer Platz)', wer: 'Kassa, Einlass, Leitung',
    schritte: [
      <>Kassa → <strong>Gäste &amp; Tickets</strong> → Ticket suchen → <strong>Umsetzen / Aufzahlen</strong>. Im Saalplan einen freien Platz wählen.</>,
      <>Höhere Kategorie: Der Aufpreis wird gleich kassiert (bar oder Karte) und erscheint auf einem normalen Kassabeleg mit dem neuen Ticket.</>,
      <>Gleich teuer oder günstiger: geht auch im Scanner (Namenssuche → Umsetzen) oder im Backend auf der Ticketseite. Günstiger: standardmäßig kein Ausgleich, auf Wunsch ein Gutschein über die Differenz (Kassa, Leitung).</>,
      <>Die Leitung kann einen Aufpreis auf der Ticketseite als Kulanz erlassen.</>,
    ],
  },
  {
    id: 'saal', titel: 'Wie viele Personen sind im Saal?', wer: 'Einlass, Leitung',
    schritte: [
      <>Im Scanner oben: <strong>Im Saal</strong>. Auf der Vorstellungsseite unter „Rund um die Vorstellung“.</>,
      <>Gezählt wird nach Einlass-Scans; Rücknahmen sind abgezogen, Rollstuhlplätze zählen mit Begleitperson als 2.</>,
      <>Für Evakuierung und Brandschutz: <strong>Anwesenheitsliste drucken</strong> auf der Vorstellungsseite.</>,
    ],
  },
  {
    id: 'nachricht', titel: 'Nachricht an alle Gäste', wer: 'Leitung',
    schritte: [
      <>Vorstellungsseite → <strong>Nachricht an alle Gäste</strong>. Zum Beispiel: Beginn verschiebt sich um 15 Minuten, warme Kleidung mitbringen, Garderobe.</>,
      <>Vor dem Senden steht, wie viele Adressen die Nachricht bekommen. Jede Adresse bekommt sie nur einmal.</>,
      <>Zum Schutz vor Doppelversand ist pro Vorstellung nur alle 5 Minuten eine Nachricht möglich. Alle Mails stehen unter „E-Mails“.</>,
    ],
  },
  {
    id: 'abbruch', titel: 'Vorstellung muss abgebrochen werden', wer: 'Leitung',
    schritte: [
      <>Zuerst die Sicherheit: Gäste nach Anweisung hinausbegleiten. Die Anwesenheitsliste hilft beim Zählen.</>,
      <>Danach auf der Vorstellungsseite <strong>Vorstellung abgebrochen …</strong>: Grund eintragen, Gutschein in % des Ticketpreises (Standard 100 %) und bestätigen.</>,
      <>Alle gültigen und eingelassenen Tickets werden storniert, jede Buchung bekommt einen Gutschein per E-Mail. Der Verkauf wird pausiert.</>,
      <>Ganz absagen (vor Beginn) geht weiter über <strong>Vorstellung absagen</strong>.</>,
    ],
  },
  {
    id: 'reserviert', titel: 'Unbezahlte Reservierungen', wer: 'Leitung',
    schritte: [
      <>Telefon-, Rechnungs- und Zahlungslink-Buchungen, die noch offen sind, verfallen automatisch vor Beginn (Standard 60 Minuten, einstellbar unter Einstellungen → Vorstellungen).</>,
      <>Die Plätze sind danach frei für die Abendkasse. Auf der Vorstellungsseite steht, wie viele Plätze betroffen sind und wann sie verfallen.</>,
    ],
  },
  {
    id: 'noshow', titel: 'Nach der Vorstellung: wer ist nicht gekommen?', wer: 'Leitung',
    schritte: [
      <>Vorstellungsseite → <strong>No-Show</strong>: verkauft und eingelassen je Kategorie und Kanal.</>,
      <>Über mehrere Vorstellungen: <Link href="/statistik#noshow" className="underline underline-offset-4">Statistik</Link> → No-Show und Freikarten nach Grund.</>,
    ],
  },
];

export default async function HilfeVorstellung() {
  await requireRole();
  return (
    <>
      <PageHeader title="Hilfe: rund um die Vorstellung" sub="Was bei einer Vorstellung passieren kann – und wo Sie klicken." />
      <nav aria-label="Inhalt" className="card mb-6 p-5">
        <h2 className="h2 mb-2">Inhalt</h2>
        <ol className="grid list-decimal gap-1 pl-5 text-sm sm:grid-cols-2">
          {FAELLE.map((f) => <li key={f.id}><a href={`#${f.id}`} className="underline underline-offset-4">{f.titel}</a></li>)}
        </ol>
      </nav>
      <div className="grid max-w-3xl gap-5">
        {FAELLE.map((f) => (
          <section key={f.id} id={f.id} aria-labelledby={`h-${f.id}`} className="card scroll-mt-6 p-5">
            <h2 id={`h-${f.id}`} className="h2">{f.titel}</h2>
            <p className="mb-2 text-sm text-muted">Wer: {f.wer}</p>
            <ol className="grid list-decimal gap-1.5 pl-5 text-base leading-relaxed">
              {f.schritte.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}
