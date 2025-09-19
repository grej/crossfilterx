import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const reportsDir = path.resolve('packages/bench/reports');
const outputPath = path.resolve('packages/bench/reports-summary.json');
const reports = readdirSync(reportsDir);

const baselineEntries = reports
  .filter((file) => file.startsWith('baseline-') && file.endsWith('.json'))
  .sort()
  .slice(-6);

const summary = baselineEntries.map((file) => {
  const json = JSON.parse(readFileSync(path.join(reportsDir, file), 'utf8'));
  const label = `${json.rows.toLocaleString()} × ${json.dimensions} (${json.columnar ? 'columnar' : 'rows'})`;
  return {
    label,
    ingest: `${json.ingestMs.toFixed(2)} ms`,
    index: `${json.index.ms.toFixed(2)} ms`,
    filter: `${json.filter.ms.toFixed(2)} ms`,
    clear: `${json.clearMs.toFixed(2)} ms`,
    report: file,
  };
});

const multiReports = reports
  .filter((file) => file.startsWith('multi-simd-profile-') && file.endsWith('.json'))
  .sort();

if (multiReports.length > 0) {
  const latestMulti = multiReports[multiReports.length - 1];
  const json = JSON.parse(readFileSync(path.join(reportsDir, latestMulti), 'utf8'));
  const filterChain = json.filters
    .map((entry) => `${entry.dim}:${entry.ms.toFixed(1)}ms`)
    .join(' → ');
  const clearChain = json.clears
    .map((entry) => `${entry.dim}:${entry.ms.toFixed(1)}ms`)
    .join(' → ');
  const shardSummary = json.shardSummary || { totalFlushes: 0, totalEvictions: 0, totalRows: 0 };
  summary.push({
    label: `multi ${json.rows.toLocaleString()} × ${json.dimensions} (simd)`,
    ingest: `${json.ingestMs.toFixed(2)} ms`,
    filterChain,
    clearChain,
    shardFlushes: shardSummary.totalFlushes,
    shardRows: shardSummary.totalRows,
    report: latestMulti,
  });
}

writeFileSync(outputPath, JSON.stringify(summary, null, 2));
console.log('Wrote benchmark summary to', outputPath);
