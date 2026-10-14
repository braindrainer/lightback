// Layout für 80-mm-Thermobons (jeder Drucker mit Systemtreiber)
export const BON_CSS = `
@page { size: 80mm auto; margin: 0; }
@media print {
  html, body { background: #fff !important; }
  body * { visibility: hidden; }
  .bon, .bon * { visibility: visible; }
  .bon { position: absolute; left: 0; top: 0; margin: 0 !important; box-shadow: none !important; border: 0 !important; }
}
.bon { width: 80mm; padding: 3mm 4mm 6mm; background: #fff; color: #000; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; line-height: 1.35; }
.bon h1, .bon h2 { font-size: 13px; font-weight: 700; margin: 0; }
.bon .z { display: flex; justify-content: space-between; gap: 6px; }
.bon .z > :last-child { text-align: right; white-space: nowrap; }
.bon hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
.bon .gross { font-size: 16px; font-weight: 700; }
.bon .qr svg { width: 46mm; height: 46mm; display: block; margin: 4px auto; }
.bon .qr-klein svg { width: 34mm; height: 34mm; display: block; margin: 2px auto; }
.bon .mitte { text-align: center; }
.bon .marke { border: 2px solid #000; text-align: center; font-weight: 700; padding: 3px; margin: 4px 0; }
`;
