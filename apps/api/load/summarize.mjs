// Turns an artillery JSON report (artillery run --output) into the baseline
// table for docs/LOAD_TEST_BASELINE.md and applies the roadmap 5 exit gate:
// checkout p95 < 500 ms and zero 5xx. Usage: node load/summarize.mjs report.json
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('usage: node load/summarize.mjs <artillery-report.json>');
const report = JSON.parse(readFileSync(file, 'utf8'));
const agg = report.aggregate;
const counters = agg.counters ?? {};
const summaries = agg.summaries ?? {};

const endpoints = ['checkout', 'dashboard-summary', 'login'];
const codeCount = (prefix, predicate) =>
  Object.entries(counters)
    .filter(([k]) => k.startsWith(prefix))
    .filter(([k]) => predicate(Number(k.slice(prefix.length))))
    .reduce((sum, [, v]) => sum + v, 0);

const rows = endpoints.map((name) => {
  const prefix = `plugins.metrics-by-endpoint.${name}.codes.`;
  const total = codeCount(prefix, () => true);
  const ok = codeCount(prefix, (c) => c >= 200 && c < 300);
  const fiveXx = codeCount(prefix, (c) => c >= 500);
  const rt = summaries[`plugins.metrics-by-endpoint.response_time.${name}`] ?? {};
  return { name, total, ok, errors: total - ok, fiveXx, errorRate: total ? ((total - ok) / total) * 100 : 0, p50: rt.median, p95: rt.p95, p99: rt.p99, max: rt.max };
});

const totalRequests = counters['http.requests'] ?? 0;
const totalResponses = counters['http.responses'] ?? 0;
const transportErrors = Object.entries(counters).filter(([k]) => k.startsWith('errors.')).reduce((s, [, v]) => s + v, 0);
const all5xx = codeCount('http.codes.', (c) => c >= 500);
const durationS = (agg.lastCounterAt - agg.firstCounterAt) / 1000;

const fmt = (v) => (v === undefined || v === null ? 'n/a' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v));
console.log(`| Endpoint | Requests | 2xx | Errors (non-2xx + transport) | 5xx | Error rate | p50 ms | p95 ms | p99 ms | max ms |`);
console.log(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
for (const r of rows) {
  console.log(`| ${r.name} | ${r.total} | ${r.ok} | ${r.errors} | ${r.fiveXx} | ${r.errorRate.toFixed(2)} % | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.p99)} | ${fmt(r.max)} |`);
}
console.log('');
console.log(`Total: ${totalRequests} requests, ${totalResponses} responses, ${transportErrors} transport errors, ${all5xx} 5xx over ${durationS.toFixed(0)} s (${(totalRequests / durationS).toFixed(1)} req/s).`);

const checkout = rows.find((r) => r.name === 'checkout');
const gate = { checkoutP95: checkout?.p95 ?? Number.POSITIVE_INFINITY, fiveXx: all5xx, transportErrors };
const pass = gate.checkoutP95 < 500 && gate.fiveXx === 0 && gate.transportErrors === 0;
console.log(`Gate (checkout p95 < 500 ms, zero 5xx, zero transport errors): ${pass ? 'PASS' : 'FAIL'} (checkout p95 ${fmt(gate.checkoutP95)} ms, 5xx ${gate.fiveXx}, transport errors ${gate.transportErrors})`);
process.exitCode = pass ? 0 : 1;
