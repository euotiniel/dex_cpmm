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
        self.initial_prices = {}

    def get_target_to_sell(self):
        pools = self.client.get_all_pools()

        if not pools:
            return None

        best_pool = None
        best_gain = -999

        for pool in pools:
            address = pool["address"]
            price = pool["spot_price"]

            if price <= 0:
                continue

            if address not in self.initial_prices:
                self.initial_prices[address] = price

            initial = self.initial_prices[address]

            if initial <= 0:
                continue

            gain = (price - initial) / initial
            balance = self.product_balance(address)

            if balance <= _CFG["min_sell_balance"]:
                continue

            if gain > best_gain:
                best_gain = gain
                best_pool = {
                    **pool,
                    "gain": gain,
                    "balance": balance,
                }

        return best_pool

    def get_target_to_buy(self):
        pools = self.client.get_all_pools()

        if not pools:
            return None

        worst_pool = None
        worst_gain = 999

        for pool in pools:
            address = pool["address"]
            price = pool["spot_price"]

            if price <= 0:
                continue

            if address not in self.initial_prices:
                self.initial_prices[address] = price

            initial = self.initial_prices[address]

            if initial <= 0:
                continue

            gain = (price - initial) / initial

            if gain < worst_gain:
                worst_gain = gain
                worst_pool = {
                    **pool,
                    "gain": gain,
                }

        return worst_pool

    def step(self):
        self.update_mood()

        cash = self.cash_balance()

        sell_target = self.get_target_to_sell()

        # 1. Pressão vendedora: vende o produto que mais subiu.
        if sell_target and random.random() < 0.65:
            sell_power = random.uniform(0.35, 0.85)
            amount = round(sell_target["balance"] * sell_power, 4)

            if amount > _CFG["min_sell_balance"]:
                self.client.sell(sell_target["address"], amount)
                self.log(
                    f"PRESSURE SELL {sell_target['symbol']} | {amount} | "
                    f"top gainer={sell_target['gain']:+.2%} | mood={self.mood}"
                )
                return

        # 2. Dump forte: também no produto que mais subiu.
        if sell_target and random.random() < 0.18:
            amount = round(sell_target["balance"] * random.uniform(0.75, 1.0), 4)

            if amount > _CFG["min_sell_balance"]:
                self.client.sell(sell_target["address"], amount)
                self.log(
                    f"HARD DUMP SELL {sell_target['symbol']} | {amount} | "
                    f"top gainer={sell_target['gain']:+.2%} | mood={self.mood}"
                )
                return

        # 3. Recarrega inventário comprando o produto que mais caiu.
        buy_target = self.get_target_to_buy()

        if buy_target and cash > _CFG["min_cash"] and random.random() < 0.45:
            base = min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"])
            base = base * random.uniform(0.35, 0.75)
            amount = self.human_amount(base, _CFG["min_buy_amount"])

            self.client.buy(buy_target["address"], amount)
            self.log(
                f"RELOAD BUY {buy_target['symbol']} | {amount} CASH | "
                f"loser={buy_target['gain']:+.2%} | mood={self.mood}"
            )
            return

        self.log(f"sem choque neste ciclo | mood={self.mood}")


if __name__ == "__main__":
    ShockBot(
        private_key=os.getenv("BOT_SHOCK_PK"),
        name="ShockBot"
    ).run()