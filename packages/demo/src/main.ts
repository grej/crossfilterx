import { crossfilterX } from '@crossfilterx/core';

const rows = Array.from({ length: 1000 }, (_, i) => ({ value: i % 256 }));
const cf = crossfilterX(rows);

void cf.whenIdle().then(() => {
  console.log('crossfilterX ready', cf.group('value').bins());
});
