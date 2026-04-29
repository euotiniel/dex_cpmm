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

        product = self.random_product()
        symbol = self.client.get_product_symbol(product)

        balance = self.product_balance(product)
        cash = self.cash_balance()

        # Crash aleatório raro: vende quase tudo sem lógica.
        if balance > _CFG["min_sell_balance"] and random.random() < 0.05:
            amount = round(balance * random.uniform(0.70, 1.00), 4)

            if amount > _CFG["min_sell_balance"]:
                self.client.sell(product, amount)
                self.log(f"PANIC CRASH SELL {symbol} | {amount} | mood={self.mood}")
                return

        if self.should_panic_sell():
            if balance > _CFG["min_sell_balance"]:
                amount = round(balance * random.uniform(0.45, 1.0), 4)
                self.client.sell(product, amount)
                self.log(f"PANIC SELL {symbol} | {amount} | mood={self.mood}")
                return

        if self.should_fomo_buy():
            if cash > _CFG["min_cash"]:
                base = min(_CFG["max_buy_cash"], cash * random.uniform(0.25, 0.75))
                amount = self.human_amount(base)
                self.client.buy(product, amount)
                self.log(f"FOMO BUY {symbol} | {amount} CASH | mood={self.mood}")
                return

        action = random.choice(["buy", "sell", "wait"])

        if action == "wait":
            self.log(f"hesitou e nao operou | mood={self.mood}")
            return

        if action == "buy":
            if cash < _CFG["min_cash"]:
                self.log("saldo CASH insuficiente para buy")
                return

            base = min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"])
            amount = self.human_amount(base, 1)

            self.client.buy(product, amount)
            self.log(f"BUY aleatorio {symbol} | {amount} CASH | mood={self.mood}")
            return

        if balance <= _CFG["min_sell_balance"]:
            self.log("saldo do produto insuficiente para sell")
            return

        base = balance * _CFG["sell_fraction"]
        amount = self.human_amount(base, _CFG["min_sell_balance"])

        self.client.sell(product, amount)
        self.log(f"SELL aleatorio {symbol} | {amount} | mood={self.mood}")


if __name__ == "__main__":
    NoiseBot(
        private_key=os.getenv("BOT_NOISE_PK"),
        name="NoiseBot"
    ).run()