import os
import random
from dotenv import load_dotenv
from bots.common.botBase import BaseBot
from bots.common.config import CONFIG

load_dotenv()
_CFG = CONFIG["trend"]


class TrendBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name, interval_key="trend")
        self.last_prices: dict = {}

    def step(self):
        products = self.client.get_all_pools()
        random.shuffle(products)

        for pool in products:
            address = pool["address"]
            symbol = pool["symbol"]
            current_price = pool["spot_price"]
            previous_price = self.last_prices.get(address)
            self.last_prices[address] = current_price

            if previous_price is None or previous_price == 0:
                continue

            cash = self.cash_balance()
            balance = self.product_balance(address)

            if current_price > previous_price * (1 + _CFG["price_up_threshold"]) and cash > _CFG["min_cash"]:
                amount = round(min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"]), 4)
                self.client.buy(address, amount)
                self.log(f"tendencia ALTA em {symbol} | BUY {amount} CASH")
                return

            if current_price < previous_price * (1 - _CFG["price_down_threshold"]) and balance > _CFG["min_sell_balance"]:
                amount = round(balance * _CFG["sell_fraction"], 4)
                self.client.sell(address, amount)
                self.log(f"tendencia BAIXA em {symbol} | SELL {amount}")
                return

        self.log("sem sinal de tendencia")


if __name__ == "__main__":
    TrendBot(private_key=os.getenv("BOT_TREND_PK"), name="TrendBot").run()
