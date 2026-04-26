import os
import random
from dotenv import load_dotenv
from bots.common.botBase import BaseBot
from bots.common.config import CONFIG

load_dotenv()
_CFG = CONFIG["conservative"]


class ConservativeBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name, interval_key="conservative")

    def step(self):
        product = self.random_product()
        pool = self.client.get_pool(product)
        symbol = self.client.get_product_symbol(product)
        cash = self.cash_balance()
        balance = self.product_balance(product)

        if cash > _CFG["min_cash"] and random.random() < _CFG["buy_probability"]:
            amount = round(min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"]), 4)
            if amount >= _CFG["min_buy_amount"]:
                self.client.buy(product, amount)
                self.log(f"BUY conservador {symbol} | {amount} CASH")
                return

        if balance > _CFG["min_sell_balance"] and pool["spot_price"] > _CFG["sell_price_threshold"]:
            amount = round(balance * _CFG["sell_fraction"], 4)
            self.client.sell(product, amount)
            self.log(f"SELL conservador {symbol} | {amount}")
            return

        self.log("sem operacao neste ciclo")


if __name__ == "__main__":
    ConservativeBot(private_key=os.getenv("BOT_CONSERVATIVE_PK"), name="ConservativeBot").run()
