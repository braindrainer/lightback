'use client';
export default function DruckKnopf({ children = 'Drucken' }: { children?: React.ReactNode }) {
  return <button type="button" onClick={() => window.print()} className="btn-primary">{children}</button>;
}
