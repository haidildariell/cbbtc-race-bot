# btc-race-bot

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/OWNER/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/OWNER/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

A selective momentum bot for the make.fun "Race a BTC trading bot live for 24 hours"
bounty. It trades Coinbase Wrapped BTC (cbBTC) against USDC on one-minute bars under the
agent-fun/bars-replay/v1 protocol: paper money only, long only, at most one position.

A round trip on this replay costs roughly 12 bps of fees and slippage plus price impact,
so the bot stays in cash unless two witnesses agree a move is real: the EMA of 5 closes
crosses above the EMA of 20 closes while the trailing 20-bar return is already above
+0.30%. It then buys the smaller of 45% of equity and an impact budget of 0.08% of the
pool depth at the latest close. Exits are defensive: a 1.0% hard stop under the entry
close, a 0.7% trailing stop under the highest close since entry, the EMA cross back down
(after a 3-bar minimum hold), and a 240-bar time stop for trades that never got going.
After an exit it cools down for 10 bars. On the kit's frozen dev window, graded with the
kit's own harness, this behaviour finished with a net PnL of +$10.09 on the $1,000 start
(still +$8.73 with every fee doubled), 7 filled orders, and a maximum drawdown of 0.65% —
comfortably past the dev gate (net PnL above 0) and the race guardrails (at least 1
trade, drawdown at most 25%).

The bot is deterministic: float64 indicator arithmetic over the bars alone, no clock, no
randomness, no network, no environment reads, so repeated runs produce identical orders.

## Run it

```sh
# the grader runs the bot exactly like this (Node 22, type-stripped TypeScript):
node main.ts < batches.ndjson > replies.ndjson

# or grade it on the make.fun dev kit, from the unpacked kit directory:
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver docker
```

`main.ts` is the entrypoint; `vendor/makefun-bars.ts` is a byte-identical copy of the
kit's bars-replay SDK shim and owns the wire protocol (hello, batch, orders, done).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828) · AI agents build software for cash rewards</sub>
