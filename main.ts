// btc-race bot: slow-trend following with momentum confirmation, a
// wide trailing stop, and near-full position sizing. Long only, one
// position at a time, CBBTC only.
//
// Why this shape: a round trip costs roughly 26-40 bps all-in (4 bps
// fee + 2 bps modelled slippage + constant-product impact, paid on
// both sides), and 1-minute bars are mostly noise, so the bot trades
// rarely and only on slow evidence: a rising 2-hour EMA with the
// close above it, and the 60-bar rate of change clearing +0.20%.
// It then commits ~95% of cash so the captured move dwarfs the
// fixed cost of trading. Exits are deliberately hard to trigger:
// only a 2.5% trailing stop under the peak close or a 4% hard stop
// under the entry price. There is no moving-average exit -- on a
// 24-hour horizon a healthy trend spends long stretches hugging
// its average, and selling every touch is how a winning day gets
// churned into a losing one. After an exit, a 30-bar cooldown.

import { runBars } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const SLOW_LEN = 120;     // slow EMA length, in bars (2 hours)
const SLOPE_LEN = 30;     // how far back to compare the slow EMA for slope
const MOM_LEN = 60;       // momentum lookback, in bars
const MOM_MIN = 0.0020;   // need +0.20% over MOM_LEN bars to enter
const TRAIL = 0.025;      // exit 2.5% below the peak close since entry
const HARD_STOP = 0.04;   // exit 4% below the entry price
const COOLDOWN = 30;      // bars to sit out after an exit
const SLIP_BPS = 100;     // max_slippage_bps offered on every order

let barsSeen = 0;
let emaSlow = 0;
let seeded = false;
const recent: number[] = [];   // last MOM_LEN+1 closes, oldest first
const slowHist: number[] = []; // last SLOPE_LEN+1 slow-EMA values, oldest first

let awaitingFill = false;    // a buy order is out; its fill lands next bar
let entryPrice = 0;          // open of the bar that filled our buy
let peakClose = 0;           // highest close since the fill
let cooldownLeft = 0;

function emaStep(prev: number, x: number, len: number): number {
  const k = 2 / (len + 1);
  return prev + k * (x - prev);
}

await runBars({
  onBatch(state, batch) {
    const orders: any[] = [];
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      const open = Number(bar.o);
      const close = Number(bar.c);

      // Indicators first: every decision below uses this bar's close.
      if (!seeded) {
        emaSlow = close;
        seeded = true;
      } else {
        emaSlow = emaStep(emaSlow, close, SLOW_LEN);
      }
      slowHist.push(emaSlow);
      if (slowHist.length > SLOPE_LEN + 1) slowHist.shift();
      recent.push(close);
      if (recent.length > MOM_LEN + 1) recent.shift();
      barsSeen += 1;
      if (cooldownLeft > 0) cooldownLeft -= 1;

      const pos = state.positions.get(SYMBOL);
      const qty = pos === undefined ? 0n : BigInt(pos.qty);
      const holding = qty > 0n;

      if (awaitingFill && holding) {
        // The buy decided on the previous bar filled at this bar's open.
        awaitingFill = false;
        entryPrice = open;
        peakClose = close > open ? close : open;
      }

      if (state.warmingUp) continue; // warm-up orders are rejected anyway

      if (holding) {
        if (close > peakClose) peakClose = close;
        const trailed = peakClose > 0 && close <= peakClose * (1 - TRAIL);
        const stopped = entryPrice > 0 && close <= entryPrice * (1 - HARD_STOP);
        if (trailed || stopped) {
          orders.push({ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SLIP_BPS });
          cooldownLeft = COOLDOWN;
          entryPrice = 0;
          peakClose = 0;
        }
      } else if (!awaitingFill && cooldownLeft === 0 && barsSeen >= SLOW_LEN + SLOPE_LEN) {
        const rising = slowHist.length > SLOPE_LEN && emaSlow > slowHist[0];
        const trendUp = rising && close > emaSlow;
        let momentum = 0;
        if (recent.length > MOM_LEN) momentum = close / recent[0] - 1;
        if (trendUp && momentum >= MOM_MIN && state.cash > 0n) {
          const notional = (state.cash * 95n) / 100n;
          if (notional > 0n) {
            orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: SLIP_BPS });
            awaitingFill = true;
          }
        }
      }
    }
    return orders;
  },
});
