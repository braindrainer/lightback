// HTML → PDF über Gotenberg (headless Chromium), wie in Elevate.
const GOTENBERG = process.env.GOTENBERG_URL || 'http://localhost:3300';

export async function htmlToPdf(html: string, assets: { name: string; data: Buffer; type: string }[] = []): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  for (const a of assets) form.append('files', new Blob([new Uint8Array(a.data)], { type: a.type }), a.name);
  form.append('paperWidth', '8.27');
  form.append('paperHeight', '11.69');
  for (const k of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight']) form.append(k, '0');
  form.append('printBackground', 'true');
  form.append('preferCssPageSize', 'true');
  const res = await fetch(`${GOTENBERG}/forms/chromium/convert/html`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`PDF-Dienst: ${res.status} ${await res.text().catch(() => '')}`);
  return Buffer.from(await res.arrayBuffer());
}
