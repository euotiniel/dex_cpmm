import os
import random

from dotenv import load_dotenv
from bots.common.botBase import BaseBot

load_dotenv()


class TrendBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name)
        self.last_prices = {}

    def step(self):
        products = self.client.get_all_pools()
        random.shuffle(products)

        for pool in products:
            address = pool["address"]
            symbol = pool["symbol"]
            current_price = pool["spot_price"]
            previous_price = self.last_prices.get(address)

            self.last_prices[address] = current_price

            if previous_price is None:
                continue

            cash = self.cash_balance()
            balance = self.product_balance(address)

            if current_price > previous_price * 1.01 and cash > 10:
                amount = round(min(25, cash * 0.15), 4)
                self.client.buy(address, amount)
                self.log(f"tendencia de alta em {symbol}, BUY com {amount} CASH")
                return

            if current_price < previous_price * 0.99 and balance > 0.02:
                amount = round(min(balance * 0.4, balance), 4)
                self.client.sell(address, amount)
                self.log(f"tendencia de baixa em {symbol}, SELL com {amount}")
                return

        self.log("sem sinal claro de tendencia")


if __name__ == "__main__":
    bot = TrendBot(
        private_key=os.getenv("BOT_TREND_PK"),
        name="TrendBot",
    )
    bot.run()