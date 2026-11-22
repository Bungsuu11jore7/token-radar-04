// radar-4: a fitted token launch radar (Node 22, standard library only).
//
// The model is fitted on the snapshot itself, never on a hardcoded list of names:
//   * universe: protocols that record no token and pass the watchlist's exclusion
//     rules (no TVL floor — the watchlist's 40 are the floor, never the ceiling).
//   * implied value: an OLS fit of log10(market cap) on log10(TVL) across the
//     traded protocols the snapshot carries (128 of 144; 16 record mcap <= 0 and
//     are dropped from the fit, see the integrity strip). The fit is computed at
//     run time from the snapshot; the constants below are only the expected
//     values main.ts asserts the run-time fit against.
//   * token odds: the share of peers of the same age that record a token,
//     computed from all 758 protocols in the snapshot.
//   * expected value = implied value x token odds; the board ranks by it.
// Terms that failed held-out validation (age, 7-day growth, category dummies,
// per-category multiples, a quadratic TVL term) are NOT used; the dashboard's
// methodology section says so, with the numbers.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_usd: number;
  odds: number;
  expected_usd: number;
  farm_cost_usd: number;
  breakeven_share: number;
  verdict: string;
  watchlist: boolean;
}

export interface FitSummary {
  n: number;
  dropped: number;
  intercept: number;
  slope: number;
  fold_a_r2: number;
  fold_a_med: number;
  fold_b_r2: number;
  fold_b_med: number;
  walk_r2: number;
  walk_med: number;
  walk_flat_r2: number;
  walk_flat_med: number;
  flat_r2: number;
  flat_med: number;
}

export interface OddsBucket {
  label: string;
  min_days: number;
  max_days: number | null;
  rate: number;
  n: number;
  with_token: number;
}

export interface Radar {
  fit: FitSummary;
  odds: OddsBucket[];
  overall_odds: number;
  rows: BoardRow[];
  accounting: {
    total: number;
    board: number;
    traded: number;
    excluded: { reason: string; count: number }[];
    watchlist: number;
    watchlist_covered: number;
  };
}

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols/watchlist are not arrays');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error('snapshot: a protocol lacks slug/name/tvl_usd');
    }
  }
  return raw;
}

/** Days between two YYYY-MM-DD dates (UTC), or null when either is missing. */
export function daysBetween(from: string | null, to: string): number | null {
  if (from === null) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  return daysBetween(p.listed_at, asOf);
}

/** Closed-form OLS for y = a + b*x on paired arrays. */
export function ols(xs: number[], ys: number[]): { intercept: number; slope: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

export function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 === 1 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** R-squared and median absolute error of a linear fit on a test set. */
export function scoreFit(
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  beta: { intercept: number; slope: number },
): { r2: number; med: number } {
  const ys = test.map((p) => Math.log10(p.mcap_usd!));
  const ym = ys.reduce((s, v) => s + v, 0) / ys.length;
  let ssRes = 0;
  let ssTot = 0;
  const errs: number[] = [];
  for (const p of test) {
    const y = Math.log10(p.mcap_usd!);
    const pred = beta.intercept + beta.slope * Math.log10(p.tvl_usd);
    errs.push(Math.abs(pred - y));
    ssRes += (pred - y) * (pred - y);
    ssTot += (y - ym) * (y - ym);
  }
  return { r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot, med: median(errs) };
}

/** The flat-multiple baseline on the same split: median log(mcap/tvl) of train. */
export function scoreFlat(train: SnapshotProtocol[], test: SnapshotProtocol[]): { r2: number; med: number } {
  const med = median(train.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd)));
  const ys = test.map((p) => Math.log10(p.mcap_usd!));
  const ym = ys.reduce((s, v) => s + v, 0) / ys.length;
  let ssRes = 0;
  let ssTot = 0;
  const errs: number[] = [];
  for (const p of test) {
    const y = Math.log10(p.mcap_usd!);
    const pred = Math.log10(p.tvl_usd) + med;
    errs.push(Math.abs(pred - y));
    ssRes += (pred - y) * (pred - y);
    ssTot += (y - ym) * (y - ym);
  }
  return { r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot, med: median(errs) };
}

/** Fit the comps model on the traded protocols and validate it held-out. */
export function fitComps(snapshot: Snapshot): FitSummary {
  const traded = snapshot.protocols.filter((p) => p.mcap_usd !== null);
  const usable = traded.filter((p) => p.mcap_usd! > 0 && p.tvl_usd > 0);
  const xs = usable.map((p) => Math.log10(p.tvl_usd));
  const ys = usable.map((p) => Math.log10(p.mcap_usd!));
  const beta = ols(xs, ys);
  const bySlug = [...usable].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const foldA = bySlug.filter((_, i) => i % 2 === 0);
  const foldB = bySlug.filter((_, i) => i % 2 === 1);
  const betaA = ols(foldA.map((p) => Math.log10(p.tvl_usd)), foldA.map((p) => Math.log10(p.mcap_usd!)));
  const betaB = ols(foldB.map((p) => Math.log10(p.tvl_usd)), foldB.map((p) => Math.log10(p.mcap_usd!)));
  const sa = scoreFit(foldA, foldB, betaA);
  const sb = scoreFit(foldB, foldA, betaB);
  // Walk-forward: fit on the older half (by listed_at), test on the younger half.
  const dated = usable.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const mid = dated.length >> 1;
  const older = dated.slice(0, mid);
  const younger = dated.slice(mid);
  const betaOld = ols(older.map((p) => Math.log10(p.tvl_usd)), older.map((p) => Math.log10(p.mcap_usd!)));
  const sw = scoreFit(older, younger, betaOld);
  const walkFlat = scoreFlat(older, younger);
  const flat = scoreFlat(foldA, foldB);
  return {
    n: usable.length,
    dropped: traded.length - usable.length,
    intercept: beta.intercept,
    slope: beta.slope,
    fold_a_r2: sa.r2,
    fold_a_med: sa.med,
    fold_b_r2: sb.r2,
    fold_b_med: sb.med,
    walk_r2: sw.r2,
    walk_med: sw.med,
    walk_flat_r2: walkFlat.r2,
    walk_flat_med: walkFlat.med,
    flat_r2: flat.r2,
    flat_med: flat.med,
  };
}

/** Token odds by age: the share of peers of the same age that record a token. */
export function oddsBuckets(snapshot: Snapshot): { buckets: OddsBucket[]; overall: number } {
  const defs: { label: string; min: number; max: number | null }[] = [
    { label: 'under 90 days', min: 0, max: 90 },
    { label: '90 days to 1 year', min: 90, max: 365 },
    { label: '1 to 2 years', min: 365, max: 730 },
    { label: '2 to 4 years', min: 730, max: 1460 },
    { label: 'over 4 years', min: 1460, max: null },
  ];
  const withToken = snapshot.protocols.filter((p) => p.mcap_usd !== null).length;
  const overall = withToken / snapshot.protocols.length;
  const buckets: OddsBucket[] = defs.map((d) => {
    const members = snapshot.protocols.filter((p) => {
      const a = ageDays(p, snapshot.as_of);
      if (a === null) return false;
      return a >= d.min && (d.max === null || a < d.max);
    });
    const withTok = members.filter((p) => p.mcap_usd !== null).length;
    return {
      label: d.label,
      min_days: d.min,
      max_days: d.max,
      rate: members.length === 0 ? overall : withTok / members.length,
      n: members.length,
      with_token: withTok,
    };
  });
  return { buckets, overall };
}

export function oddsFor(p: SnapshotProtocol, asOf: string, buckets: OddsBucket[], overall: number): number {
  const a = ageDays(p, asOf);
  if (a === null) return overall;
  for (const b of buckets) {
    if (a >= b.min_days && (b.max_days === null || a < b.max_days)) return b.rate;
  }
  return overall;
}

// The watchlist's exclusion rules, minus the TVL floor (the board goes below it).
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Why a no-token protocol is NOT a pre-token subject, or null when it is one. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (WRAPPED_WORD.test(p.name)) return 'wrapped / staked product';
  for (const e of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(e)) return `exchange product (${e})`;
  }
  if (VERSION_SUFFIX.test(p.name)) return 'versioned release';
  return null;
}

// Gas cost per interaction, in USD — estimates, labelled as such on the board.
const GAS_USD: Record<string, number> = {
  Ethereum: 8.0,
  Base: 0.5,
  Arbitrum: 0.5,
  Optimism: 0.5,
  Solana: 0.05,
  BSC: 0.3,
  Polygon: 0.1,
  Avalanche: 0.4,
};
const BRIDGE_FEE_USD = 12.0;

export function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
}

export function gasUsd(chain: string): number {
  return GAS_USD[chain] ?? 1.0;
}

export function depositUsd(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 1000;
  if (p.tvl_usd >= 100_000_000) return 500;
  return 100;
}

function money(n: number): string {
  return n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n}`;
}

function coreAction(p: SnapshotProtocol, dep: number, weeks: number, gas: number): string {
  const chain = primaryChain(p);
  switch (p.category) {
    case 'Dexs':
      return `Swap ${money(dep)} into the pool's assets on ${p.name} (${chain}), then add ${money(dep)} as liquidity and keep the LP receipt; gas about ${money(gas)} per transaction.`;
    case 'Lending':
      return `Supply ${money(dep)} as collateral on ${p.name} (${chain}), then borrow a small amount against it and repay it the same week to leave a borrow record; gas about ${money(gas)} per transaction.`;
    case 'Yield':
      return `Deposit ${money(dep)} into the ${p.name} vault on ${chain} and leave it earning for ${weeks} weeks; gas about ${money(gas)} per transaction.`;
    case 'RWA':
      return `Mint or hold a ${money(dep)} position in ${p.name} on ${chain} and keep it through the ${weeks}-week window; gas about ${money(gas)} per transaction.`;
    case 'CDP':
      return `Open a CDP vault on ${p.name} (${chain}) with ${money(dep)} of collateral and mint a small amount of its stable asset; gas about ${money(gas)} per transaction.`;
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return `Allocate ${money(dep)} to a ${p.name} curator vault on ${chain} and leave the allocation untouched for ${weeks} weeks; gas about ${money(gas)} per transaction.`;
    default:
      return `Use ${p.name} on ${chain} with ${money(dep)}: run its core transaction (deposit, swap or stake) and keep the position open for ${weeks} weeks; gas about ${money(gas)} per transaction.`;
  }
}

/** Five concrete farm steps with costs and durations; total cost and verdict included. */
export function farmPlan(p: SnapshotProtocol, odds: number): { steps: string[]; cost: number; weeks: number; verdict: string; breakeven: number; expected: number } {
  const chain = primaryChain(p);
  const gas = gasUsd(chain);
  const dep = depositUsd(p);
  const weeks = odds >= 0.22 ? 8 : odds >= 0.12 ? 6 : 4;
  const bridge = chain === 'Ethereum' || chain === 'Solana' ? 0 : BRIDGE_FEE_USD;
  const interactions = 1 + weeks + 1;
  const cost = gas * interactions + bridge;
  const steps = [
    `Hold ${money(dep)} in stablecoins on ${chain}, ready to deploy for ${p.name}; budget about ${money(gas)} for the first transaction, about 10 minutes of your time.`,
    coreAction(p, dep, weeks, gas),
    `Repeat the core action once a week for ${weeks} weeks, one transaction a week at about ${money(gas)} of gas each, so the activity reads as steady use rather than a single spike.`,
    `Save every transaction hash, date and amount for ${p.name} in one note; airdrop checks ask for proof of use, and a dated record is the proof. No cost, about 5 minutes a week.`,
    `When ${p.name} announces a token, follow its claim page at once, then withdraw the ${money(dep)} of capital; the exit costs about ${money(gas)} in gas and the capital comes back to you.`,
  ];
  return { steps, cost, weeks, verdict: '', breakeven: 0, expected: 0 };
}

/** Build the whole radar from the snapshot: fit, odds, board, accounting. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const fit = fitComps(snapshot);
  const { buckets, overall } = oddsBuckets(snapshot);
  const watch = new Set(snapshot.watchlist);
  const excludedCount: { reason: string; count: number }[] = [];
  const excludedMap = new Map<string, number>();
  const rows: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null) continue;
    const reason = exclusionReason(p);
    if (reason !== null) {
      excludedMap.set(reason, (excludedMap.get(reason) ?? 0) + 1);
      continue;
    }
    const implied = Math.max(1, Math.round(10 ** (fit.intercept + fit.slope * Math.log10(p.tvl_usd))));
    const odds = oddsFor(p, snapshot.as_of, buckets, overall);
    const expected = Math.max(1, Math.round(implied * odds));
    const plan = farmPlan(p, odds);
    const breakeven = plan.cost / expected;
    // Verdict from BOTH risks: (a) the token may never launch — odds under 5%
    // (a protocol listed under 90 days launches 4% of the time) is a long shot
    // even when the farm is cheap; (b) the breakeven share — what fraction of
    // the launch value the farmer must capture to cover cost. Skip: odds < 5%
    // or breakeven >= 1%. Thin: odds < 12% or breakeven >= 0.01%. Farm: else.
    const verdict = odds < 0.05 || breakeven >= 0.01 ? 'Skip' : odds < 0.12 || breakeven >= 0.0001 ? 'Thin' : 'Farm';
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: expected,
      farm_steps: plan.steps,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays(p, snapshot.as_of),
      implied_usd: implied,
      odds,
      expected_usd: expected,
      farm_cost_usd: plan.cost,
      breakeven_share: breakeven,
      verdict,
      watchlist: watch.has(p.slug),
    });
  }
  rows.sort((a, b) => b.expected_usd - a.expected_usd || b.implied_usd - a.implied_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  for (const [reason, count] of [...excludedMap.entries()].sort((a, b) => b[1] - a[1])) {
    excludedCount.push({ reason, count });
  }
  const traded = snapshot.protocols.filter((p) => p.mcap_usd !== null).length;
  const radar: Radar = {
    fit,
    odds: buckets,
    overall_odds: overall,
    rows,
    accounting: {
      total: snapshot.protocols.length,
      board: rows.length,
      traded,
      excluded: excludedCount,
      watchlist: snapshot.watchlist.length,
      watchlist_covered: rows.filter((r) => r.watchlist).length,
    },
  };
  return { board: rows, radar };
}

/** The dashboard's data file: the board plus the fit, odds and accounting. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** The gate's own shape checks, run before writing: null when the board is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows (need 100-4000)`;
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i} has rank ${r.rank}, want ${i + 1}`;
    if (i > 0 && board[i - 1]!.implied_value_usd < r.implied_value_usd) return `implied value rises at rank ${r.rank}`;
    if (seen.has(r.slug)) return `slug ${r.slug} twice`;
    seen.add(r.slug);
    if (!snapshot.protocols.some((p) => p.slug === r.slug)) return `slug ${r.slug} is not in the snapshot`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug}: a farm step is ${t.length} chars`;
    }
  }
  for (const w of snapshot.watchlist) {
    if (!seen.has(w)) return `watchlist slug ${w} is missing`;
  }
  return null;
}
