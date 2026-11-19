import { describe, it, expect } from 'vitest';
import { esZonaNejapa } from '../src/core/negados/parseo';
import { dedupRecords } from '../src/core/negados/dedup';

describe('Reglas de Nejapa (19-nov-2026)', () => {
  it('excluye las ubicaciones que no son de Nejapa', () => {
    for (const u of ['HC01A01', 'PV-03', 'CL12B02', 'ROTOTEC CONSTRU', 'TRANSITO-BAZINNI', 'TRANSITO-MATCO', 'TRASLADO MOBU-NNEO']) expect(esZonaNejapa(u)).toBe(false);
    for (const u of ['01A02', 'PAS-29', 'BL01', 'BM03', 'ROTOTEC', 'NAV-2025', '', null]) expect(esZonaNejapa(u)).toBe(true);
  });
  it('quita duplicados solo por Pedido + SKU (dos pedidos en la misma orden cuentan dos)', () => {
    const base = { SKU: 'A', Orden: '1', Cantidad: 5, CantPrep: 5, Disponible: 3, Estado: 'A' } as any;
    const r = dedupRecords([{ ...base, Pedido: '370001' }, { ...base, Pedido: '430001' }, { ...base, Pedido: '370001' }]);
    expect(r.rows.length).toBe(2);
    expect(r.dedupPedidoSku).toBe(1);
    expect(r.dedupOrdenSku).toBe(0);
  });
});
