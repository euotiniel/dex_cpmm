import os
import random
from dotenv import load_dotenv

from bots.common.botBase import BaseBot
from bots.common.config import CONFIG
from bots.common.human_behavior import HumanBehavior

load_dotenv()
_CFG = CONFIG["conservative"]


class ConservativeBot(BaseBot, HumanBehavior):
    def __init__(self, private_key: str, name: str):
        BaseBot.__init__(self, private_key, name, interval_key="conservative")
        HumanBehavior.__init__(self)

    def step(self):
        self.update_mood()

        product = self.random_product()
        pool = self.client.get_pool(product)
        symbol = self.client.get_product_symbol(product)

        cash = self.cash_balance()
        balance = self.product_balance(product)

        buy_probability = _CFG["buy_probability"]

        if self.mood == "greedy":
            buy_probability += 0.2
        elif self.mood == "fearful":
            buy_probability -= 0.25
        elif self.mood == "confused":
            buy_probability = random.uniform(0.2, 0.7)

        if self.should_panic_sell() and balance > _CFG["min_sell_balance"]:
            amount = self.human_amount(balance * random.uniform(0.4, 0.9), _CFG["min_sell_balance"])
            self.client.sell(product, amount)
            self.log(f"PANIC SELL conservador {symbol} | {amount} | mood={self.mood}")
            return

        if cash > _CFG["min_cash"] and random.random() < buy_probability:
            base = min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"])
            amount = self.human_amount(base, _CFG["min_buy_amount"])

            if amount >= _CFG["min_buy_amount"]:
                self.client.buy(product, amount)
                self.log(f"BUY conservador {symbol} | {amount} CASH | mood={self.mood}")
                return

        sell_threshold = _CFG["sell_price_threshold"] * random.uniform(0.92, 1.08)

        if balance > _CFG["min_sell_balance"] and pool["spot_price"] > sell_threshold:
            if self.should_ignore_signal():
                self.log(f"viu oportunidade mas ignorou {symbol} | mood={self.mood}")
                return

            base = balance * _CFG["sell_fraction"]
            amount = self.human_amount(base, _CFG["min_sell_balance"])

            self.client.sell(product, amount)
            self.log(f"SELL conservador {symbol} | {amount} | mood={self.mood}")
            return

        self.log(f"sem operacao neste ciclo | mood={self.mood}")


if __name__ == "__main__":
    ConservativeBot(private_key=os.getenv("BOT_CONSERVATIVE_PK"), name="ConservativeBot").run()