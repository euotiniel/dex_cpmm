import os
import random
from dotenv import load_dotenv

from bots.common.botBase import BaseBot
from bots.common.config import CONFIG
from bots.common.human_behavior import HumanBehavior

load_dotenv()
_CFG = CONFIG["momentum"]


class MomentumBot(BaseBot, HumanBehavior):
    def __init__(self, private_key: str, name: str):
        BaseBot.__init__(self, private_key, name, interval_key="momentum")
        HumanBehavior.__init__(self)
        self.last_prices = {}

    def step(self):
        self.update_mood()

        pools = self.client.get_all_pools()
        random.shuffle(pools)

        best_product = None
        best_growth = None

        for pool in pools:
            address = pool["address"]
            current_price = pool["spot_price"]
            previous_price = self.last_prices.get(address)

            self.last_prices[address] = self.noisy_price(current_price)

            if previous_price is None or previous_price == 0:
                continue

            growth = (current_price - previous_price) / previous_price
            growth += random.uniform(-0.004, 0.004)

            if best_growth is None or growth > best_growth:
                best_growth = growth
                best_product = pool

        if best_product is None:
            self.log(f"sem historico suficiente ainda | mood={self.mood}")
            return

        address = best_product["address"]
        symbol = best_product["symbol"]

        cash = self.cash_balance()
        balance = self.product_balance(address)

        up_threshold = self.noisy_threshold(_CFG["up_threshold"])
        down_threshold = self.noisy_threshold(_CFG["down_threshold"])

        if best_growth > up_threshold and cash > _CFG["min_cash"]:
            if self.should_ignore_signal():
                self.log(f"ignorou momentum positivo {symbol} | mood={self.mood}")
                return

            base = min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"])
            amount = self.human_amount(base, 1)

            self.client.buy(address, amount)
            self.log(f"momentum POSITIVO {symbol} ({best_growth:+.2%}) | BUY {amount} CASH | mood={self.mood}")
            return

        if best_growth < -down_threshold and balance > _CFG["min_sell_balance"]:
            if self.should_ignore_signal():
                self.log(f"ignorou momentum negativo {symbol} | mood={self.mood}")
                return

            base = balance * _CFG["sell_fraction"]
            amount = self.human_amount(base, _CFG["min_sell_balance"])

            self.client.sell(address, amount)
            self.log(f"momentum NEGATIVO {symbol} ({best_growth:+.2%}) | SELL {amount} | mood={self.mood}")
            return

        if self.should_do_random_trade():
            product = self.random_product()
            symbol = self.client.get_product_symbol(product)

            cash = self.cash_balance()
            if cash > _CFG["min_cash"]:
                amount = self.human_amount(min(_CFG["max_buy_cash"], cash * 0.15), 1)
                self.client.buy(product, amount)
                self.log(f"entrada impulsiva fora do momentum {symbol} | BUY {amount} | mood={self.mood}")
                return

        self.log(f"momentum neutro | mood={self.mood}")


if __name__ == "__main__":
    MomentumBot(private_key=os.getenv("BOT_MOMENTUM_PK"), name="MomentumBot").run()