import os
from dotenv import load_dotenv
from bots.common.botBase import BaseBot
from bots.common.config import CONFIG

load_dotenv()
_CFG = CONFIG["momentum"]


class MomentumBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name, interval_key="momentum")
        self.last_prices: dict = {}

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

        if best_growth > _CFG["up_threshold"] and cash > _CFG["min_cash"]:
            amount = round(min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"]), 4)
            self.client.buy(address, amount)
            self.log(f"momentum POSITIVO {symbol} ({best_growth:+.2%}) | BUY {amount} CASH")
            return

        if best_growth < -_CFG["down_threshold"] and balance > _CFG["min_sell_balance"]:
            amount = round(balance * _CFG["sell_fraction"], 4)
            self.client.sell(address, amount)
            self.log(f"momentum NEGATIVO {symbol} ({best_growth:+.2%}) | SELL {amount}")
            return

        self.log("momentum neutro")


if __name__ == "__main__":
    MomentumBot(private_key=os.getenv("BOT_MOMENTUM_PK"), name="MomentumBot").run()
