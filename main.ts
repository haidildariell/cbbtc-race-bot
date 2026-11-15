// Selective momentum rider for the cbBTC bars-replay race (agent-fun/bars-replay/v1).
//
// Idea: on one-minute bars a full round trip costs roughly 12 bps of fees and slippage plus
// price impact, so most minutes are not worth trading. This bot stays in cash and only rides
// a move when two independent witnesses agree it is real:
//   - the fast EMA (5 closes) crosses above the slow EMA (20 closes), and
//   - the trailing 20-bar return is already above +0.30%, so the cross is a trend, not noise.
// Position size is the smaller of 45% of equity and an impact budget (the spend is capped at
// 0.08% of the pool depth the latest close reported, which keeps modelled impact near 8 bps).
// Exits are defensive, because the entry witness is slow by design:
//   - a hard stop 1.0% under the entry close,
//   - a trailing stop 0.7% under the highest close since entry,
//   - the EMA cross back down (only after a 3-bar minimum hold, so one flat bar cannot
//     whipsaw the position out),
//   - a 240-bar time stop when the trade never got going (at or under +0.2%).
// After any exit the bot waits 10 bars before it may enter again. Everything is decided from
// the bars alone (float64 EMA arithmetic, no clock, no randomness), so the two graded runs of
// this entry produce byte-identical action logs.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const FAST_SPAN = 5;
const SLOW_SPAN = 20;
const MOM_BARS = 20;
const MOM_THRESH = 0.003; // trailing return must exceed +0.30%
const FRAC_NUM = 45n; // at most 45% of equity per entry
const FRAC_DEN = 100n;
const IMPACT_NUM = 8n; // spend at most 0.08% of the latest close's pool depth
const IMPACT_DEN = 10_000n;
const TRAIL_PCT = 0.007;
const STOP_PCT = 0.01;
const MAX_HOLD_BARS = 240;
const TIME_STOP_MAX_GAIN = 0.002;
const COOLDOWN_BARS = 10;
const MIN_HOLD_BARS = 3;
const MAX_SLIPPAGE_BPS = 200;
const MIN_ENTRY_QUOTE = 10_000_000n; // never open under 10 USDC

const closes: number[] = [];
let emaFast: number | null = null;
let emaSlow: number | null = null;
let prevGap: number | null = null;
let entryBar = -1;
let entryPrice: number | null = null;
let peakSinceEntry: number | null = null;
let cooldownUntil = -1;

function stepEma(current: number, span: number, close: number): number {
  return current + (2 / (span + 1)) * (close - current);
}

await runBars({
  onBatch(state: BarsState, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return []; // a minute with no CBBTC bar adds nothing
    if (state.warmingUp) return [];

    const close = Number(bar.c);
    // A malformed bar must never poison the EMAs: one non-finite or non-positive close would
    // turn every later gap and momentum reading into NaN and silently end the bot's race.
    if (!Number.isFinite(close) || close <= 0) return [];
    closes.push(close);
    if (closes.length === FAST_SPAN) emaFast = closes.reduce((a, x) => a + x, 0) / FAST_SPAN;
    else if (closes.length > FAST_SPAN && emaFast !== null) emaFast = stepEma(emaFast, FAST_SPAN, close);
    if (closes.length === SLOW_SPAN) emaSlow = closes.reduce((a, x) => a + x, 0) / SLOW_SPAN;
    else if (closes.length > SLOW_SPAN && emaSlow !== null) emaSlow = stepEma(emaSlow, SLOW_SPAN, close);
    const gap = emaFast !== null && emaSlow !== null ? emaFast - emaSlow : null;
    const retMom = closes.length > MOM_BARS ? close / closes[closes.length - 1 - MOM_BARS] - 1 : null;

    const held = state.positions.get(SYMBOL);
    let order: BuyInput | SellInput | null = null;

    if (held !== undefined && held.qty > 0n) {
      if (peakSinceEntry === null || close > peakSinceEntry) peakSinceEntry = close;
      const heldBars = state.seq - entryBar;
      const trailStop = peakSinceEntry !== null && close <= peakSinceEntry * (1 - TRAIL_PCT);
      const hardStop = entryPrice !== null && close <= entryPrice * (1 - STOP_PCT);
      const crossDown = heldBars >= MIN_HOLD_BARS && gap !== null && prevGap !== null && gap < 0 && prevGap >= 0;
      const timeStop =
        entryPrice !== null && heldBars >= MAX_HOLD_BARS && close <= entryPrice * (1 + TIME_STOP_MAX_GAIN);
      if (trailStop || hardStop || crossDown || timeStop) {
        order = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        peakSinceEntry = null;
        entryPrice = null;
        cooldownUntil = state.seq + COOLDOWN_BARS;
      }
    } else if (
      state.seq >= cooldownUntil &&
      gap !== null &&
      prevGap !== null &&
      retMom !== null &&
      gap > 0 &&
      prevGap <= 0 &&
      retMom > MOM_THRESH
    ) {
      const depth = state.depthAt(SYMBOL);
      if (depth !== null && depth.length > 0) {
        const byFrac = (state.equity * FRAC_NUM) / FRAC_DEN;
        const byImpact = (depth[0] * IMPACT_NUM) / IMPACT_DEN;
        let notional = byFrac < byImpact ? byFrac : byImpact;
        if (state.cash < notional) notional = state.cash;
        const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
        if (notional >= MIN_ENTRY_QUOTE && notional >= minNotional) {
          order = { side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS };
          entryBar = state.seq;
          entryPrice = close;
          peakSinceEntry = close;
        }
      }
    }

    prevGap = gap;
    return order === null ? [] : [order];
  },
});
