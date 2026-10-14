'use client';
// Kopiert den Handy-Link der Tickets (absolute Adresse dieses Backends).
import { useState } from 'react';

export default function LinkKopieren({ pfad, className = 'btn-secondary btn-sm' }: { pfad: string; className?: string }) {
  const [status, setStatus] = useState('');
  async function kopieren() {
    const url = `${window.location.origin}${pfad}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Link kopiert.');
    } catch {
      window.prompt('Link zum Kopieren:', url);
    }
    setTimeout(() => setStatus(''), 4000);
  }
  return (
    <>
      <button type="button" onClick={kopieren} className={className}>Link kopieren</button>
      <span role="status" className="text-sm text-muted">{status}</span>
    </>
  );
}
