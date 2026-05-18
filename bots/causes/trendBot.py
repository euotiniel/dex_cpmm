import os
import random
from dotenv import load_dotenv

from bots.common.botBase import BaseBot
from bots.common.config import CONFIG
from bots.common.human_behavior import HumanBehavior

load_dotenv()
_CFG = CONFIG["trend"]


class TrendBot(BaseBot, HumanBehavior):
    def __init__(self, private_key: str, name: str):
        BaseBot.__init__(self, private_key, name, interval_key="trend")
        HumanBehavior.__init__(self)
        self.last_prices = {}

    def pool_key(self, pool):
        return pool["pool_id"].hex() if hasattr(pool["pool_id"], "hex") else str(pool["pool_id"])

    def weight_multiplier(self, symbol_in, symbol_out):
        weights = self.client.get_grading_weights()
        w_in = weights.get(symbol_in, 0)
        w_out = weights.get(symbol_out, 0)

        diff = w_out - w_in

        if w_out >= 60:
            return random.uniform(1.35, 1.85)

        if diff >= 35:
            return random.uniform(1.2, 1.5)

        if diff >= 15:
            return random.uniform(1.0, 1.25)

        if diff <= -40:
            return random.uniform(0.25, 0.55)

        if diff <= -20:
            return random.uniform(0.45, 0.8)

        return random.uniform(0.75, 1.1)

    def should_follow_trend(self, symbol_in, symbol_out, change):
        weights = self.client.get_grading_weights()

        w_in = weights.get(symbol_in, 0)
        w_out = weights.get(symbol_out, 0)

        if w_out >= 60:
            return True

        if w_out > w_in:
            return True

        if abs(change) >= _CFG["threshold"] * 3:
            return random.random() < 0.55

        return random.random() < 0.25

    def step(self):
        self.update_mood()

        pools = self.pools()
        random.shuffle(pools)

        for pool in pools:
            key = self.pool_key(pool)
            current = pool["price01"]
            previous = self.last_prices.get(key)

            self.last_prices[key] = self.noisy_price(current)

            if previous is None or previous <= 0:
                continue

            change = (current - previous) / previous
            threshold = self.noisy_threshold(_CFG["threshold"])

            if abs(change) < threshold:
                continue

            if change > 0:
                # token0 valorizou contra token1, então compra token0 com token1
                token_in = pool["token1"]
                token_out = pool["token0"]
                symbol_in = pool["symbol1"]
                symbol_out = pool["symbol0"]
                direction = "alta"
            else:
                # token1 valorizou contra token0, então compra token1 com token0
                token_in = pool["token0"]
                token_out = pool["token1"]
                symbol_in = pool["symbol0"]
                symbol_out = pool["symbol1"]
                direction = "baixa"

            if not self.should_follow_trend(symbol_in, symbol_out, change):
                self.log(
                    f"tendencia ignorada por peso {symbol_in}->{symbol_out} | "
                    f"change={change:+.2%} | mood={self.mood}"
                )
                return

            if self.should_ignore_signal():
                self.log(f"ignorou tendencia de {direction} em {pool['pair']} | mood={self.mood}")
                return

            fraction = _CFG["trade_fraction"] * self.weight_multiplier(symbol_in, symbol_out)

            amount = self.amount_from_balance(
                token_in,
                fraction,
                _CFG["max_trade"],
                _CFG["min_balance"]
            )

            if amount is None:
                self.log(f"saldo insuficiente para seguir tendencia {symbol_in}->{symbol_out}")
                return

            self.swap(token_in, token_out, amount)

            weights = self.client.get_grading_weights()
            self.log(
                f"TREND WEIGHTED {direction.upper()} {pool['pair']} | "
                f"{amount} {symbol_in}->{symbol_out} | "
                f"change={change:+.2%} | peso {symbol_out}={weights.get(symbol_out, 0)}% | mood={self.mood}"
            )
            return

        self.log(f"sem sinal de tendencia | mood={self.mood}")


if __name__ == "__main__":
    TrendBot(
        private_key=os.getenv("BOT_TREND_PK"),
        name="TrendBot"
    ).run()