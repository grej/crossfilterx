import type { MsgToWorker } from '@crossfilterx/core';

export type Scenario = {
  name: string;
  script: () => AsyncGenerator<MsgToWorker> | Generator<MsgToWorker>;
};

export const brushSweep: Scenario = {
  name: 'brush-sweep',
  *script() {
    for (let step = 0; step < 64; step++) {
      yield { t: 'FILTER_SET', dimId: 0, lo: step, hi: step + 4, seq: step };
    }
  }
};
