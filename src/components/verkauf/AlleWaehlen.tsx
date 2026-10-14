'use client';
// Kontrollkästchen "alle auswählen" für Tabellen in einem Formular
export default function AlleWaehlen({ name, label = 'Alle auswählen' }: { name: string; label?: string }) {
  return (
    <input type="checkbox" aria-label={label} className="h-5 w-5 accent-accent"
      onChange={(e) => e.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => { c.checked = e.currentTarget.checked; })} />
  );
}
