import os
import random
from dotenv import load_dotenv

from bots.common.botBase import BaseBot
from bots.common.config import CONFIG
from bots.common.human_behavior import HumanBehavior

load_dotenv()
_CFG = CONFIG["noise"]


class NoiseBot(BaseBot, HumanBehavior):
    def __init__(self, private_key: str, name: str):
        BaseBot.__init__(self, private_key, name, interval_key="noise")
        HumanBehavior.__init__(self)

    def weighted_random_pool(self):
        pools = self.pools()
        if not pools:
            return None

        weights = self.client.get_grading_weights()

        scored = []
        for pool in pools:
            w0 = weights.get(pool["symbol0"], 0)
            w1 = weights.get(pool["symbol1"], 0)
            score = max(1, w0 + w1)
            scored.append((pool, score))

        total = sum(score for _, score in scored)
        r = random.uniform(0, total)

        acc = 0
        for pool, score in scored:
            acc += score
            if r <= acc:
                return pool

        return random.choice(pools)

    def choose_direction(self, pool):
        weights = self.client.get_grading_weights()

        w0 = weights.get(pool["symbol0"], 0)
        w1 = weights.get(pool["symbol1"], 0)

        if w0 == w1:
            return random.choice([
                (pool["token0"], pool["token1"], pool["symbol0"], pool["symbol1"]),
                (pool["token1"], pool["token0"], pool["symbol1"], pool["symbol0"]),
            ])

        # Noise continua aleatório, mas com viés para comprar token de maior peso.
        if random.random() < 0.68:
            if w0 > w1:
                return pool["token1"], pool["token0"], pool["symbol1"], pool["symbol0"]
            return pool["token0"], pool["token1"], pool["symbol0"], pool["symbol1"]

        return random.choice([
            (pool["token0"], pool["token1"], pool["symbol0"], pool["symbol1"]),
            (pool["token1"], pool["token0"], pool["symbol1"], pool["symbol0"]),
        ])

    def amount_multiplier_by_weight(self, symbol_in, symbol_out):
        weights = self.client.get_grading_weights()

        w_in = weights.get(symbol_in, 0)
        w_out = weights.get(symbol_out, 0)
        diff = w_out - w_in

        if diff >= 50:
            return random.uniform(1.25, 1.7)

        if diff >= 25:
            return random.uniform(1.05, 1.35)

        if diff <= -30:
            return random.uniform(0.35, 0.7)

        return random.uniform(0.75, 1.15)

    def step(self):
        self.update_mood()

        pool = self.weighted_random_pool()

        if not pool:
            self.log("sem pools")
            return

        token_in, token_out, symbol_in, symbol_out = self.choose_direction(pool)

        fraction = _CFG["trade_fraction"]
        fraction *= self.amount_multiplier_by_weight(symbol_in, symbol_out)

        if self.mood == "impulsive":
            fraction *= random.uniform(1.15, 1.75)

        if self.mood == "fearful":
            fraction *= random.uniform(0.55, 1.0)

        amount = self.amount_from_balance(
            token_in,
            fraction,
            _CFG["max_trade"],
            _CFG["min_balance"]
        )

        if amount is None:
            self.log(f"saldo insuficiente para swap {symbol_in}->{symbol_out} | mood={self.mood}")
            return

        if random.random() < 0.18:
            self.log(f"hesitou e nao operou | mood={self.mood}")
            return

        self.swap(token_in, token_out, amount)

        weights = self.client.get_grading_weights()
        self.log(
            f"NOISE WEIGHTED SWAP {amount} {symbol_in}->{symbol_out} | "
            f"peso {symbol_in}={weights.get(symbol_in, 0)}% / "
            f"{symbol_out}={weights.get(symbol_out, 0)}% | mood={self.mood}"
        )


if __name__ == "__main__":
    NoiseBot(
        private_key=os.getenv("BOT_NOISE_PK"),
        name="NoiseBot"
    ).run()