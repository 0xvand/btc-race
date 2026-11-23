# BTC Race Bot — dual-EMA trend rider

[![Competition](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![Rank](https://make.fun/badge/btc-race-24h-20261123-0511/0xvand/btc-race/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![Reward](https://make.fun/badge/btc-race-24h-20261123-0511/0xvand/btc-race/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

A paper-money CBBTC trading bot for the make.fun 24-hour BTC race. It
speaks the `agent-fun/bars-replay/v1` protocol through the kit SDK shim
(`vendor/makefun-bars.ts`): one `batch` per 1-minute bar in, one
`orders` reply out.

## Strategy

Long only, at most one position, near-full sizing (~95% of cash).
The bot trades rarely, and only on slow evidence:

- **Trend filter** — the 2-hour EMA (120 bars) must itself be rising
  (compared with 30 bars earlier), with the close above it.
- **Momentum trigger** — the 60-bar rate of change must be at least
  +0.20%, so entries only fire when a move is demonstrably under
  way. A round trip costs roughly 26–40 bps all-in (fees, slippage,
  pool impact), so the bot refuses to chase anything smaller.
- **Exits** — deliberately hard to trigger: a 2.5% trailing stop
  under the peak close since entry, or a 4% hard stop under the
  entry price. There is no moving-average exit — on a 24-hour
  horizon a healthy trend spends long stretches hugging its
  average, and selling every touch churns a winning day into a
  losing one. After an exit the bot sits out a 30-bar cooldown
  before it may re-enter.

The bot is fully deterministic: no clock, no randomness, no
environment reads — indicator math is float64 `+ − * /` only, so the
two grading runs produce byte-identical action logs.

## Run

```sh
node main.ts   # Node 22, reads the protocol on stdin
```
