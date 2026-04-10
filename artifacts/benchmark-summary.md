# Flint Benchmark Summary

| Scenario | Min Output | Result | Improvement |
| --- | --- | --- | --- |
| Single solver baseline | `95,000,000` | `96,000,000` | `+1,000,000` (`105 bps`) |
| Two solver competition | `95,000,000` | `98,000,000` | `+3,000,000` (`315 bps`) |
| Timeout recovery | `95,000,000` min target | `100,000,000` input refunded | Funds recovered |

Notes:

- The baseline path shows the minimum price improvement once one registered solver competes.
- The competitive path shows the auction improvement when a second solver outbids the first.
- The timeout path demonstrates that user funds are not stranded even when a winning bid goes unfilled.
