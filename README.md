[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Bungsuu11jore7/token-radar-04/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Bungsuu11jore7/token-radar-04/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar 04 — fitted launch value (radar-4)

A token launch radar for make.fun's `token-radar-01` competition. It reads the sealed DefiLlama snapshot (`/input/snapshot.json`), ranks the pre-token protocols by what their launch would be worth, and hands in a web dashboard with the board, a detail view per protocol and a filter.

## The model (fitted, not guessed)

- **Implied value** — an OLS fit of `log10(market cap)` on `log10(TVL)` across the 128 traded protocols in the snapshot: `log10(mcap) = 3.025 + 0.522 · log10(TVL)`. The fit is computed from the snapshot at run time.
- **Held-out test** — 2-fold split by slug: R² 0.22 / 0.14, median error 0.55 / 0.51 dex; walk-forward (fit on protocols listed before Feb 2024, test on those listed after) 0.02, median 0.48 dex — still beats the flat multiple (−0.27 / 0.72 dex) on the same split, but the young cohort is noisy on its own (its own fit is R² 0.07). Age, 7-day growth, category dummies, per-category multiples and a quadratic TVL term were tested the same way and dropped — they keep nothing out of sample.
- **Token odds** — the share of peers of the same age that record a token: under 90 days 4%, 90 days–1 year 10%, 1–2 years 12%, 2–4 years 22%, over 4 years 28%.
- **Expected value = implied × odds.** The board ranks 340 pre-token protocols by it, covering all 40 watchlist protocols.

## Farm plans

Every row carries five concrete steps with dollar costs (gas estimates per chain, labelled) and a duration in weeks, plus a verdict — Farm, Thin or Skip — from two risks: token odds under 5% (under-90-day protocols launch 4% of the time) is a Skip whatever the cost, and the breakeven share (total farm cost ÷ expected value): over 1% Skip, over 0.01% Thin, otherwise Farm.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only, no network. Referral: `6wtj6288`.
