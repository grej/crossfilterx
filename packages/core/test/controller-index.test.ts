import { describe, expect, it } from 'vitest';

import { WorkerController, type DimensionSpec } from '../src/controller';
import { crossfilterX } from '../src/index';

describe('WorkerController index tracking', () => {
  it('marks index ready after build', async () => {
    const schema: DimensionSpec[] = [{ name: 'value', type: 'number', bits: 4 }];
    const rows = Array.from({ length: 8 }, (_, i) => ({ value: i }));
    const controller = new WorkerController(schema, { kind: 'rows', data: rows }, {});

    await controller.whenIdle();
    const dimId = controller.dimensionId('value');
    expect(controller.indexStatus(dimId)?.ready).toBe(false);

    await controller.buildIndex(dimId);
    const status = controller.indexStatus(dimId);
    expect(status?.ready).toBe(true);
    expect((status?.bytes ?? 0) > 0).toBe(true);

    controller.dispose();
  });

  it('exposes index status through public API', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ value: i }));
    const cf = crossfilterX(rows, {});
    expect(cf.indexStatus('value')?.ready).toBe(false);
    await cf.buildIndex('value');
    const status = cf.indexStatus('value');
    expect(status?.ready).toBe(true);
    expect((status?.bytes ?? 0) > 0).toBe(true);
    cf.dispose();
  });
});
