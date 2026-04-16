import os
import random

from dotenv import load_dotenv
from bots.common.botBase import BaseBot

load_dotenv()


class MomentumBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name)
        self.last_prices = {}

    def step(self):
        pools = self.client.get_all_pools()

        best_product = None
        best_growth = None

        for pool in pools:
            address = pool["address"]
            current_price = pool["spot_price"]
            previous_price = self.last_prices.get(address)

            self.last_prices[address] = current_price

            if previous_price is None or previous_price == 0:
                continue

            growth = (current_price - previous_price) / previous_price

            if best_growth is None or growth > best_growth:
                best_growth = growth
                best_product = pool

        if best_product is None:
            self.log("sem historico suficiente ainda")
            return

        address = best_product["address"]
        symbol = best_product["symbol"]
        cash = self.cash_balance()
        balance = self.product_balance(address)

        if best_growth > 0.01 and cash > 10:
            amount = round(min(30, cash * 0.2), 4)
            self.client.buy(address, amount)
            self.log(f"momentum positivo em {symbol}, BUY com {amount} CASH")
            return

        if best_growth < -0.01 and balance > 0.02:
            amount = round(min(balance * 0.5, balance), 4)
            self.client.sell(address, amount)
            self.log(f"momentum negativo em {symbol}, SELL com {amount}")
            return

        self.log("momentum neutro")


if __name__ == "__main__":
    bot = MomentumBot(
        private_key=os.getenv("BOT_MOMENTUM_PK"),
        name="MomentumBot",
    )
    bot.run()