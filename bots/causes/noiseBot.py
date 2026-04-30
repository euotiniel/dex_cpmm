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

    def step(self):
        self.update_mood()

        pool = self.random_pool()

        if not pool:
            self.log("sem pools")
            return

        if random.random() < 0.5:
            token_in = pool["token0"]
            token_out = pool["token1"]
            symbol_in = pool["symbol0"]
            symbol_out = pool["symbol1"]
        else:
            token_in = pool["token1"]
            token_out = pool["token0"]
            symbol_in = pool["symbol1"]
            symbol_out = pool["symbol0"]

        fraction = _CFG["trade_fraction"]

        if self.mood == "impulsive":
            fraction *= random.uniform(1.2, 2.0)

        if self.mood == "fearful":
            fraction *= random.uniform(0.7, 1.5)

        amount = self.amount_from_balance(
            token_in,
            fraction,
            _CFG["max_trade"],
            _CFG["min_balance"]
        )

        if amount is None:
            self.log(f"saldo insuficiente para swap {symbol_in}->{symbol_out} | mood={self.mood}")
            return

        if random.random() < 0.20:
            self.log(f"hesitou e nao operou | mood={self.mood}")
            return

        self.swap(token_in, token_out, amount)
        self.log(f"NOISE SWAP {amount} {symbol_in} -> {symbol_out} | mood={self.mood}")


if __name__ == "__main__":
    NoiseBot(
        private_key=os.getenv("BOT_NOISE_PK"),
        name="NoiseBot"
    ).run()