import os
import random

from dotenv import load_dotenv
from bots.common.botBase import BaseBot

load_dotenv()


class ShockBot(BaseBot):
    def step(self):
        product = self.random_product()
        action = random.choice(["buy", "sell", "buy"])

        if action == "buy":
            cash = self.cash_balance()
            if cash < 25:
                self.log("saldo de CASH insuficiente para choque de compra")
                return

            amount = round(random.uniform(20, min(80, cash * 0.5)), 4)
            self.client.buy(product, amount)
            self.log(f"choque BUY em {self.client.get_product_symbol(product)} com {amount} CASH")
        else:
            balance = self.product_balance(product)
            if balance < 0.05:
                self.log("saldo do produto insuficiente para choque de venda")
                return

            amount = round(random.uniform(0.05, min(balance, balance * 0.8)), 4)
            self.client.sell(product, amount)
            self.log(f"choque SELL em {self.client.get_product_symbol(product)} com {amount}")


if __name__ == "__main__":
    bot = ShockBot(
        private_key=os.getenv("BOT_SHOCK_PK"),
        name="ShockBot",
    )
    bot.run()