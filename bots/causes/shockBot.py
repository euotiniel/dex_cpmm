import os
import random
from dotenv import load_dotenv
from bots.common.botBase import BaseBot
from bots.common.config import CONFIG

load_dotenv()
_CFG = CONFIG["shock"]


class ShockBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name, interval_key="shock")

    def step(self):
        product = self.random_product()
        # Weighted: 2 buys for every 1 sell
        action = random.choice(["buy", "buy", "sell"])

        if action == "buy":
            cash = self.cash_balance()
            if cash < _CFG["min_cash"]:
                self.log("saldo insuficiente para choque de compra")
                return
            amount = round(random.uniform(_CFG["min_buy_amount"], min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"])), 4)
            self.client.buy(product, amount)
            self.log(f"CHOQUE BUY {self.client.get_product_symbol(product)} | {amount} CASH")
        else:
            balance = self.product_balance(product)
            if balance < _CFG["min_sell_balance"]:
                self.log("saldo insuficiente para choque de venda")
                return
            amount = round(random.uniform(_CFG["min_sell_balance"], balance * _CFG["sell_fraction"]), 4)
            self.client.sell(product, amount)
            self.log(f"CHOQUE SELL {self.client.get_product_symbol(product)} | {amount}")


if __name__ == "__main__":
    ShockBot(private_key=os.getenv("BOT_SHOCK_PK"), name="ShockBot").run()
