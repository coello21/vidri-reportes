/**
 * Solo en el artefacto (scripts/artefacto.mjs, XLSX_CDN=1): en vez de llevar SheetJS adentro, se usa la misma
 * versión 0.18.5 cargada desde cdnjs (window.XLSX, con su huella SRI). Se lee al usarla, así la página abre
 * aunque no cargue; solo fallan las funciones de Excel (Cargar Excel y las descargas en Excel).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const g = (): any => {
  const x = (globalThis as any).XLSX;
  if (!x) throw new Error('No cargó la librería de Excel (se necesita internet).');
  return x;
};
export const read = (...a: any[]) => g().read(...a);
export const write = (...a: any[]) => g().write(...a);
export const utils: any = new Proxy({}, { get: (_t, k) => g().utils[k] });
export const SSF: any = new Proxy({}, { get: (_t, k) => g().SSF[k] });
