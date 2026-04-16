import os
import random

from dotenv import load_dotenv
from bots.common.botBase import BaseBot

load_dotenv()


class ConservativeBot(BaseBot):
    def step(self):
        product = self.random_product()
        pool = self.client.get_pool(product)
        symbol = self.client.get_product_symbol(product)

        cash = self.cash_balance()
        balance = self.product_balance(product)

        if cash > 15 and random.random() < 0.6:
            amount = round(min(8, cash * 0.08), 4)
            if amount >= 1:
                self.client.buy(product, amount)
                self.log(f"BUY conservador em {symbol} com {amount} CASH")
                return

        if balance > 0.03 and pool["spot_price"] > 9:
            amount = round(min(balance * 0.25, balance), 4)
            self.client.sell(product, amount)
            self.log(f"SELL conservador em {symbol} com {amount}")
            return

        self.log("sem operacao neste ciclo")


if __name__ == "__main__":
    bot = ConservativeBot(
        private_key=os.getenv("BOT_CONSERVATIVE_PK"),
        name="ConservativeBot",
    )
    bot.run()