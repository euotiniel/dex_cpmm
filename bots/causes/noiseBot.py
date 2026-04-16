import os
import random

from dotenv import load_dotenv
from bots.common.botBase import BaseBot

load_dotenv()


class NoiseBot(BaseBot):
    def step(self):
        product = self.random_product()
        action = random.choice(["buy", "sell"])

        if action == "buy":
            cash = self.cash_balance()
            if cash < 5:
                self.log("saldo de CASH muito baixo para buy")
                return

            amount = round(random.uniform(1, min(20, cash * 0.2)), 4)
            self.client.buy(product, amount)
            self.log(f"buy executado em {self.client.get_product_symbol(product)} com {amount} CASH")
        else:
            balance = self.product_balance(product)
            if balance <= 0.01:
                self.log("saldo do produto muito baixo para sell")
                return

            amount = round(random.uniform(0.01, min(balance, balance * 0.5)), 4)
            self.client.sell(product, amount)
            self.log(f"sell executado em {self.client.get_product_symbol(product)} com {amount}")


if __name__ == "__main__":
    bot = NoiseBot(
        private_key=os.getenv("BOT_NOISE_PK"),
        name="NoiseBot",
    )
    bot.run()