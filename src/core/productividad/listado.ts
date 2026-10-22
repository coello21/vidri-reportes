/**
 * Listado de preparadores, metas y reglas de la página de Productividad (iguales a la página original).
 */

/** [código, nombre, tipo, estado] */
export type Persona = [number | null, string, string, string];

/** Listado base de preparadores (el que traía la página original). Los agregados desde la página van en la base (prod_personal). */
export const BASE: Persona[] = [
  [6468, "Josué Daniel Méndez Galdámez", "B2B", "Activo"],
  [8925, "Jorge Enrique González de la Cruz", "B2B", "Activo"],
  [9195, "Elmer Eduardo Galdámez Cartagena", "B2B", "Activo"],
  [9913, "RODRIGO ALBERTO GUIROLA VALENCIA", "B2B", "Activo"],
  [9914, "STEVEN EMMANUEL LOPEZ DURAN", "B2B", "Activo"],
  [10225, "Óscar Lizandro Sibrian Escobar", "B2B", "Activo"],
  [5385, "Cristian Arnoldo Gil Palencia", "Maestro de Olas", "Activo"],
  [6131, "Alexander Esau Henriquez Campos", "Maestro de Olas", "Activo"],
  [6605, "CARLOS ENMANUEL SERRANO ORELLANA", "Retail", "Activo"],
  [9080, "CARLOS FERNANDO ORTIZ GUMERO", "Retail", "Activo"],
  [9444, "Guillermo Ernesto Segura Balcaceres", "Retail", "Activo"],
  [9480, "KEVIN JOSUE RAMIREZ CORTEZ", "Retail", "Activo"],
  [9912, "JESUS ALEXANDER SOLIS FUENTES", "Retail", "Activo"],
  [9923, "BRYAN ALEJANDRO FLORES GARCIA", "Retail", "Activo"],
  [9982, "CESAR DAVID NAVAS CRESPIN", "Retail", "Activo"],
  [10109, "DIEGO ISRAEL VEGA MARTINEZ", "Retail", "Activo"],
  [10330, "NAHIN ANSELMO PEREZ LOPEZ", "Retail", "Activo"],
  [10341, "SAMUEL ISAAC CERROS PALMA", "Retail", "Activo"],
  [10350, "SARA GUADALUPE CAMPOS LOPEZ", "Retail", "Activo"],
  [10359, "KATERINNE VANESSA CAMPOS SALAZAR", "Retail", "Activo"],
  [10422, "JOCELYN YAMILETH URRUTIA BELTRAN", "Retail", "Activo"],
  [10478, "ANGEL ARIEL ANCHETA AYALA", "Retail", "Activo"],
  [10568, "KATHIE ANNETTE CHAVEZ CARPIO", "Retail", "Activo"],
  [10581, "GISSELA DEL CARMEN GARCIA HERNANDEZ", "Retail", "Activo"],
  [10588, "CRISCIA CAROLINA RAMIREZ NERIO", "Retail", "Activo"],
  [10647, "JENNIFER ESTHER ORELLANA RIVAS", "Retail", "Activo"],
  [10745, "CASEY MAYERLY LINARES BARRERA", "Retail", "Activo"],
  [10746, "YEIMY LISSETH ELIAS ORELLANA", "Retail", "Activo"],
  [10752, "ARACELY YAMILETH SALINAS HUEZO", "Retail", "Activo"],
  [10835, "KATHERINE ESMERALDA TORRES ESCOBAR", "Retail", "Activo"],
  [10839, "ALISSON STEFANI ANZORA ORELLANA", "Retail", "Activo"],
  [10854, "LAURA MARCELA MAZARIEGO CANIZALEZ", "Retail", "Activo"],
  [10860, "PAMELA ISADORA GUARDADO MENJIVAR", "Retail", "Activo"],
  [11144, "ERIKA DEL CARMEN PORTILLO SANTOS", "Retail", "Activo"],
  [9924, "WILLIAM ALEXANDER ZECEÑA ORELLANA", "Retail", "Baja"],
  [10227, "MARVIN ENRIQUE ORELLANA SANDOVAL", "Retail", "Baja"],
  [10992, "ALEJANDRA MICHELLE AGUILAR CAPACHO", "Retail", "Baja"],
  [null, "ADONAY ALEXANDER SOLIS CACERES", "Apoyo", "Activo"],
  [null, "JULIO CESAR AYALA MENDEZ", "B2B", "Activo"],
];

export interface Meta { n: string; m: number; t: number }
/** Metas en SKUs por hora (n = nombre, m = meta, t = tolerancia amarilla). Salen de Meta.xlsx. */
export const METAS: Meta[] = [
  { n: "Zona 1", m: 90.0, t: 15 },
  { n: "Zona 2", m: 80.0, t: 15 },
  { n: "Zona 3", m: 50.0, t: 15 },
  { n: "Zona 4", m: 50.0, t: 15 },
  { n: "Zona 5", m: 50.0, t: 15 },
  { n: "Zona 6", m: 50.0, t: 15 },
  { n: "Zona 7", m: 60.0, t: 15 },
  { n: "Zona 8", m: 45.0, t: 15 },
  { n: "Zona 9", m: 25.0, t: 15 },
  { n: "Zona 10", m: 25.0, t: 15 },
  { n: "Zona 11", m: 25.0, t: 15 },
  { n: "Zona 12", m: 40.0, t: 15 },
  { n: "Zona 13", m: 50.0, t: 15 },
  { n: "Zona 14", m: 25.0, t: 15 },
  { n: "Ventas", m: 15.0, t: 5 },
  { n: "Ventas Corporativas", m: 12.0, t: 5 },
  { n: "Patio", m: 5.0, t: 5 },
  { n: "Ventas en Linea", m: 15.0, t: 5 },
];
export const GLOBAL: Meta = { n: 'Global', m: 50, t: 15 };

/** Duración máxima por orden (horas) y mínimo por SKU (segundos): reglas fijas. */
export const MAX_HORAS = 4, MIN_SEG = 10;

export const norm = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
/** Clave de una persona: el nombre normalizado con las palabras ordenadas (así coincide aunque cambie el orden). */
export const clave = (s: unknown): string => norm(s).split(' ').sort().join(' ');

const MAPA = new Map(METAS.map((x) => [norm(x.n), x]));
export const meta = (nombre: string): Meta | undefined => MAPA.get(norm(nombre));
export const metaZona = (z: string): Meta => meta(z) || GLOBAL;

export type Categoria = 'b2b' | 'exi' | 'rot' | 'lin' | 'ven' | 'otr';
export function categoria(tipo: unknown): Categoria {
  const T = norm(tipo);
  if (T.includes('VENTA CORPORATIVA')) return 'b2b';
  if (T.includes('EXISTENCIA')) return 'exi';
  if (T.includes('ROTACION')) return 'rot';
  if (T.includes('LINEA') || T.includes('VIDRI')) return 'lin';
  if (T.includes('VENTA') || T.includes('VTA')) return 'ven';
  return 'otr';
}

const NUM: Record<string, number> = { UNO: 1, DOS: 2, TRES: 3, CUATRO: 4, CINCO: 5, SEIS: 6, SIETE: 7, OCHO: 8, NUEVE: 9, DIEZ: 10, ONCE: 11, DOCE: 12, TRECE: 13, CATORCE: 14, QUINCE: 15 };
/** Zona(s) de una orden: k = nombre ("Zona 1", "Zona 1 + Zona 2", "Patio"…), n = número para ordenar, l = lista. */
export function zona(z: unknown): { k: string; n: number; l: string[] } {
  const m = new Map<string, number>();
  for (const s of String(z || '').split(',').map(norm).filter(Boolean)) {
    const g = s.match(/^ZONA (\w+)$/), n = g ? (/^\d+$/.test(g[1]) ? +g[1] : NUM[g[1]]) : 0;
    m.set(n ? 'Zona ' + n : s[0] + s.slice(1).toLowerCase(), n || 99);
  }
  const L = [...m].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return { k: L.map((x) => x[0]).join(' + ') || 'Sin zona', n: L.length ? L[0][1] : 100, l: L.map((x) => x[0]) };
}

/** Semana ISO de un día "AAAA-MM-DD" → "AAAA-SS". */
export function semana(day: string): string {
  const t = new Date(day + 'T12:00:00');
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const y = t.getFullYear(), j = new Date(y, 0, 4);
  return y + '-' + String(1 + Math.round(((t.getTime() - j.getTime()) / 864e5 - 3 + ((j.getDay() + 6) % 7)) / 7)).padStart(2, '0');
}
