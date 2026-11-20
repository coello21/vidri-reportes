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

/** En el artefacto de Claude las descargas pasan por su permiso «downloads» (el visor pide confirmar). */
let guardar: ((blob: Blob, nombre: string) => Promise<void>) | null = null;
export function usarGuardado(fn: (blob: Blob, nombre: string) => Promise<void>) { guardar = fn; }

export function descargar(blob: Blob, nombre: string) {
  if (guardar) { guardar(blob, nombre).catch((e) => aviso('err', 'No se descargó: ' + ((e as Error)?.message || (e as { code?: string })?.code || 'cancelado'), 10000)); return; }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
