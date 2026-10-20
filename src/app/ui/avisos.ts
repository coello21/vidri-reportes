/** Mensajes de estado y descargas (igual que el Radar original). */
let t: number | undefined;
export function aviso(tipo: 'ok' | 'err', texto: string, ms = 6000) {
  const el = document.getElementById('statusMsg');
  if (!el) return;
  el.textContent = texto;
  el.className = 'status-msg show ' + tipo;
  clearTimeout(t);
  t = window.setTimeout(() => { el.className = 'status-msg'; }, ms);
}

export function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
