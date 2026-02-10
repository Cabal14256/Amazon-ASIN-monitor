# Analytics API Benchmark Report Template

## 1. Metadata

- Date:
- Owner:
- Old environment:
- New environment:
- Data window:
- Notes:

## 2. Benchmark Configuration

- Endpoints:
  - `/api/v1/monitor-history/statistics/all-countries-summary`
  - `/api/v1/monitor-history/statistics/region-summary`
  - `/api/v1/monitor-history/statistics/period-summary`
- Query params:
  - `startTime=`
  - `endTime=`
  - `timeSlotGranularity=`
  - `country=`
  - `site=`
  - `brand=`
  - `current=`
  - `pageSize=`
- Sampling:
  - warmup:
  - runs:
  - timeoutMs:

## 3. Summary

| Endpoint | Old Avg | New Avg | Avg Delta | Old P95 | New P95 | P95 Delta | Old Pass | New Pass |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| all-countries-summary |  |  |  |  |  |  |  |  |
| region-summary |  |  |  |  |  |  |  |  |
| period-summary |  |  |  |  |  |  |  |  |

Notes:

- Delta formula: `(old - new) / old * 100%`
- Positive delta means the new project is faster.

## 4. Endpoint Details

### 4.1 all-countries-summary

- Old: min / p50 / p90 / p95 / avg / max
- New: min / p50 / p90 / p95 / avg / max
- Failure samples:

### 4.2 region-summary

- Old: min / p50 / p90 / p95 / avg / max
- New: min / p50 / p90 / p95 / avg / max
- Failure samples:

### 4.3 period-summary

- Old: min / p50 / p90 / p95 / avg / max
- New: min / p50 / p90 / p95 / avg / max
- Failure samples:

## 5. Conclusion and Action Items

- Conclusion:
- Current bottlenecks:
- Next actions (sorted by impact):
  1.
  2.
  3.

## 6. Attachments

- Script JSON output:
- Script Markdown output:
- Related logs:
