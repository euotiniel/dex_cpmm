import os
import random
from dotenv import load_dotenv

from bots.common.botBase import BaseBot
from bots.common.config import CONFIG
from bots.common.human_behavior import HumanBehavior

load_dotenv()
_CFG = CONFIG["trend"]


class TrendBot(BaseBot, HumanBehavior):
    def __init__(self, private_key: str, name: str):
        BaseBot.__init__(self, private_key, name, interval_key="trend")
        HumanBehavior.__init__(self)
        self.last_prices = {}

    def step(self):
        self.update_mood()

        products = self.client.get_all_pools()
        random.shuffle(products)

        if self.should_do_random_trade():
            product = self.random_product()
            symbol = self.client.get_product_symbol(product)

            if random.choice(["buy", "sell"]) == "buy":
                cash = self.cash_balance()
                if cash > _CFG["min_cash"]:
                    amount = self.human_amount(min(_CFG["max_buy_cash"], cash * 0.2), 1)
                    self.client.buy(product, amount)
                    self.log(f"TRADE IRRACIONAL BUY {symbol} | {amount} CASH | mood={self.mood}")
                    return
            else:
                balance = self.product_balance(product)
                if balance > _CFG["min_sell_balance"]:
                    amount = self.human_amount(balance * 0.4, _CFG["min_sell_balance"])
                    self.client.sell(product, amount)
                    self.log(f"TRADE IRRACIONAL SELL {symbol} | {amount} | mood={self.mood}")
                    return

        for pool in products:
            address = pool["address"]
            symbol = pool["symbol"]
            current_price = pool["spot_price"]

            previous_price = self.last_prices.get(address)
            self.last_prices[address] = self.noisy_price(current_price)

            if previous_price is None or previous_price == 0:
                continue

            cash = self.cash_balance()
            balance = self.product_balance(address)

            up_threshold = self.noisy_threshold(_CFG["price_up_threshold"])
            down_threshold = self.noisy_threshold(_CFG["price_down_threshold"])

            if current_price > previous_price * (1 + up_threshold):
                if self.should_ignore_signal():
                    self.log(f"ignorou tendencia ALTA {symbol} | mood={self.mood}")
                    return

                if cash > _CFG["min_cash"]:
                    base = min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"])
                    amount = self.human_amount(base, 1)

                    self.client.buy(address, amount)
                    self.log(f"tendencia ALTA {symbol} | BUY {amount} CASH | mood={self.mood}")
                    return

            if current_price < previous_price * (1 - down_threshold):
                if self.should_ignore_signal():
                    self.log(f"ignorou tendencia BAIXA {symbol} | mood={self.mood}")
                    return

                if balance > _CFG["min_sell_balance"]:
                    base = balance * _CFG["sell_fraction"]
                    amount = self.human_amount(base, _CFG["min_sell_balance"])

                    self.client.sell(address, amount)
                    self.log(f"tendencia BAIXA {symbol} | SELL {amount} | mood={self.mood}")
                    return

        self.log(f"sem sinal de tendencia | mood={self.mood}")


if __name__ == "__main__":
    TrendBot(private_key=os.getenv("BOT_TREND_PK"), name="TrendBot").run()