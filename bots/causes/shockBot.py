import os
import random
from dotenv import load_dotenv

from bots.common.botBase import BaseBot
from bots.common.config import CONFIG
from bots.common.human_behavior import HumanBehavior

load_dotenv()
_CFG = CONFIG["shock"]


class ShockBot(BaseBot, HumanBehavior):
    def __init__(self, private_key: str, name: str):
        BaseBot.__init__(self, private_key, name, interval_key="shock")
        HumanBehavior.__init__(self)

    def step(self):
        self.update_mood()

        product = self.random_product()
        symbol = self.client.get_product_symbol(product)

        balance = self.product_balance(product)
        cash = self.cash_balance()

        # Tenta provocar queda vendendo uma parte grande do inventário.
        # Isto só funciona depois do bot já ter acumulado tokens.
        if balance > _CFG["min_sell_balance"] and random.random() < 0.35:
            sell_power = random.uniform(0.55, 0.95)
            amount = round(balance * sell_power, 4)

            if amount > _CFG["min_sell_balance"]:
                self.client.sell(product, amount)
                self.log(
                    f"DUMP SELL {symbol} | {amount} | queda provocada | mood={self.mood}"
                )
                return

        # Se ainda não tem produto suficiente, compra para criar inventário.
        if cash > _CFG["min_cash"] and random.random() < 0.55:
            base = min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"])
            amount = self.human_amount(base, _CFG["min_buy_amount"])

            self.client.buy(product, amount)
            self.log(
                f"ACUMULACAO BUY {symbol} | {amount} CASH | mood={self.mood}"
            )
            return

        # Venda normal quando há saldo, mesmo sem dump.
        if balance > _CFG["min_sell_balance"]:
            base = balance * _CFG["sell_fraction"]
            amount = self.human_amount(base, _CFG["min_sell_balance"])

            self.client.sell(product, amount)
            self.log(
                f"CHOQUE SELL {symbol} | {amount} | mood={self.mood}"
            )
            return

        self.log(f"sem saldo para provocar queda em {symbol} | mood={self.mood}")


if __name__ == "__main__":
    ShockBot(
        private_key=os.getenv("BOT_SHOCK_PK"),
        name="ShockBot"
    ).run()