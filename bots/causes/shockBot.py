import os
import random
from dotenv import load_dotenv

from bots.common.botBase import BaseBot
from bots.common.config import CONFIG
from bots.common.human_behavior import HumanBehavior

load_dotenv()
_CFG = CONFIG["shock"]


class ShockBot(BaseBot, HumanBehavior):
    def __init__(self, private_key: str, name: str):
        BaseBot.__init__(self, private_key, name, interval_key="shock")
        HumanBehavior.__init__(self)

    def step(self):
        self.update_mood()

        product = self.random_product()
        symbol = self.client.get_product_symbol(product)

        if self.mood == "greedy":
            action = random.choice(["buy", "buy", "buy", "sell"])
        elif self.mood == "fearful":
            action = random.choice(["sell", "sell", "buy"])
        elif self.mood == "confused":
            action = random.choice(["buy", "sell", "wait"])
        else:
            action = random.choice(["buy", "buy", "sell"])

        if action == "wait":
            self.log(f"choque cancelado por indecisao | mood={self.mood}")
            return

        if action == "buy":
            cash = self.cash_balance()
            if cash < _CFG["min_cash"]:
                self.log("saldo insuficiente para choque de compra")
                return

            base = min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"])
            amount = self.human_amount(base, _CFG["min_buy_amount"])

            self.client.buy(product, amount)
            self.log(f"CHOQUE BUY {symbol} | {amount} CASH | mood={self.mood}")

        else:
            balance = self.product_balance(product)
            if balance < _CFG["min_sell_balance"]:
                self.log("saldo insuficiente para choque de venda")
                return

            base = balance * _CFG["sell_fraction"]
            amount = self.human_amount(base, _CFG["min_sell_balance"])

            self.client.sell(product, amount)
            self.log(f"CHOQUE SELL {symbol} | {amount} | mood={self.mood}")


if __name__ == "__main__":
    ShockBot(private_key=os.getenv("BOT_SHOCK_PK"), name="ShockBot").run()