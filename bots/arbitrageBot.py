import os
import random
from dotenv import load_dotenv
from bots.common.botBase import BaseBot
from bots.common.config import CONFIG
from bots.common.randomBehavior import (
    buy_amount,
    sell_amount,
    maybe_ignore_signal,
    maybe_explore,
    random_action,
    randomize_threshold,
)

load_dotenv()
_CFG = CONFIG["arbitrage"]


class ArbitrageBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name, interval_key="arbitrage")

    def exploratory_trade(self):
        pools = self.client.get_all_pools()

        if not pools:
            self.log("sem pools")
            return

        target = random.choice(pools)
        action = random_action()

        cash = self.cash_balance()
        balance = self.product_balance(target["address"])

        if action == "buy":
            if cash < _CFG["min_cash"]:
                self.log("saldo CASH insuficiente")
                return

            amount, intensity = buy_amount(cash, _CFG)

            if amount is None:
                self.log("ARB exploração BUY ignorada")
                return

            self.client.buy(target["address"], amount)
            self.log(f"{intensity.upper()} ARB EXPLORATION BUY {target['symbol']} | {amount} CASH")
            return

        amount, intensity = sell_amount(balance, _CFG)

        if amount is None:
            self.log("ARB exploração SELL ignorada")
            return

        self.client.sell(target["address"], amount)
        self.log(f"{intensity.upper()} ARB EXPLORATION SELL {target['symbol']} | {amount}")

    def step(self):
        pools = self.client.get_all_pools()
        anchor = _CFG["anchor_price"]

        cheapest = None
        most_expensive = None
        cheapest_deviation = 0
        most_expensive_deviation = 0

        for pool in pools:
            price = pool["spot_price"]

            if price <= 0:
                continue

            deviation = (price - anchor) / anchor

            if deviation < cheapest_deviation:
                cheapest_deviation = deviation
                cheapest = pool

            if deviation > most_expensive_deviation:
                most_expensive_deviation = deviation
                most_expensive = pool

        if not cheapest and not most_expensive:
            if random.random() < 0.4:
                self.exploratory_trade()
                return

            self.log("sem oportunidade")
            return

        spread = most_expensive_deviation - cheapest_deviation
        min_spread = randomize_threshold(_CFG["min_spread_pct"])

        if spread < min_spread:
            if random.random() < 0.4:
                self.exploratory_trade()
                return

            self.log(f"spread fraco ({spread:.2%})")
            return

        if maybe_ignore_signal():
            self.log("arbitragem ignorou oportunidade")
            return

        cheap_threshold = randomize_threshold(_CFG["cheap_threshold_pct"])
        expensive_threshold = randomize_threshold(_CFG["expensive_threshold_pct"])

        cash = self.cash_balance()

        if cheapest and abs(cheapest_deviation) >= cheap_threshold:
            if cash < _CFG["min_cash"]:
                self.log("saldo CASH insuficiente")
                return

            amount, intensity = buy_amount(cash, _CFG)

            if amount is None:
                self.log("BUY arbitragem ignorado")
                return

            self.client.buy(cheapest["address"], amount)
            self.log(
                f"{intensity.upper()} ARB BUY barato {cheapest['symbol']} | "
                f"{amount} CASH | desvio={cheapest_deviation:+.2%}"
            )
            return

        if most_expensive and most_expensive_deviation >= expensive_threshold:
            balance = self.product_balance(most_expensive["address"])

            amount, intensity = sell_amount(balance, _CFG)

            if amount is None:
                self.log("SELL arbitragem ignorado")
                return

            self.client.sell(most_expensive["address"], amount)
            self.log(
                f"{intensity.upper()} ARB SELL caro {most_expensive['symbol']} | "
                f"{amount} | desvio={most_expensive_deviation:+.2%}"
            )
            return

        if random.random() < 0.4:
            self.exploratory_trade()
            return

        self.log("oportunidade abaixo do threshold")


if __name__ == "__main__":
    ArbitrageBot(
        private_key=os.getenv("BOT_ARBITRAGE_PK"),
        name="ArbitrageBot"
    ).run()