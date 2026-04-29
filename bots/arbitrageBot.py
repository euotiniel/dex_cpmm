import os
import random
from dotenv import load_dotenv

from bots.common.botBase import BaseBot
from bots.common.config import CONFIG
from bots.common.randomBehavior import buy_amount, sell_amount, randomize_threshold

load_dotenv()
_CFG = CONFIG["arbitrage"]


class ArbitrageBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name, interval_key="arbitrage")
        self.last_prices = {}

    def _market_average(self, pools):
        prices = [p["spot_price"] for p in pools if p["spot_price"] > 0]

        if not prices:
            return 0

        return sum(prices) / len(prices)

    def _exploratory_trade(self, pools):
        if random.random() > _CFG.get("explore_probability", 0.25):
            self.log("sem arbitragem clara")
            return

        target = random.choice(pools)
        action = random.choice(["buy", "sell"])

        if action == "buy":
            cash = self.cash_balance()

            if cash < _CFG["min_cash"]:
                self.log("saldo CASH insuficiente para exploracao")
                return

            amount, intensity = buy_amount(cash, _CFG)

            if amount is None:
                self.log("ARB exploração BUY ignorada")
                return

            self.client.buy(target["address"], amount)

            self.log(
                f"{intensity.upper()} ARB EXPLORATION BUY "
                f"{target['symbol']} | {amount} CASH"
            )
            return

        balance = self.product_balance(target["address"])
        amount, intensity = sell_amount(balance, _CFG)

        if amount is None:
            self.log("ARB exploração SELL ignorada")
            return

        self.client.sell(target["address"], amount)

        self.log(
            f"{intensity.upper()} ARB EXPLORATION SELL "
            f"{target['symbol']} | {amount}"
        )

    def _momentum_escape(self, pools):
        """
        Pequena saída prática: se um produto subiu muito desde a última leitura
        e o bot tem saldo, vende parte. Ajuda o bot a não ficar eternamente
        só comprando.
        """
        if random.random() > _CFG.get("momentum_exit_probability", 0.18):
            return False

        random.shuffle(pools)

        for pool in pools:
            address = pool["address"]
            price = pool["spot_price"]
            previous = self.last_prices.get(address)

            self.last_prices[address] = price

            if previous is None or previous <= 0 or price <= 0:
                continue

            move = (price - previous) / previous

            if move < _CFG.get("momentum_exit_pct", 0.006):
                continue

            balance = self.product_balance(address)
            amount, intensity = sell_amount(balance, _CFG)

            if amount is None:
                continue

            self.client.sell(address, amount)

            self.log(
                f"{intensity.upper()} ARB MOMENTUM EXIT SELL "
                f"{pool['symbol']} | {amount} | move={move:+.2%}"
            )
            return True

        return False

    def step(self):
        pools = self.client.get_all_pools()

        if not pools:
            self.log("sem pools")
            return

        average_price = self._market_average(pools)

        if average_price <= 0:
            self.log("preco medio invalido")
            return

        cheapest = None
        most_expensive = None
        cheapest_deviation = 0.0
        expensive_deviation = 0.0

        for pool in pools:
            price = pool["spot_price"]

            if price <= 0:
                continue

            deviation = (price - average_price) / average_price

            if deviation < cheapest_deviation:
                cheapest_deviation = deviation
                cheapest = pool

            if deviation > expensive_deviation:
                expensive_deviation = deviation
                most_expensive = pool

        spread = expensive_deviation - cheapest_deviation
        min_spread = randomize_threshold(_CFG["min_spread_pct"])

        if spread < min_spread:
            if self._momentum_escape(pools):
                return

            self._exploratory_trade(pools)
            return

        cheap_threshold = randomize_threshold(_CFG["cheap_threshold_pct"])
        expensive_threshold = randomize_threshold(_CFG["expensive_threshold_pct"])

        cash = self.cash_balance()

        if cheapest and abs(cheapest_deviation) >= cheap_threshold:
            if cash < _CFG["min_cash"]:
                self.log("saldo CASH insuficiente")
            else:
                amount, intensity = buy_amount(cash, _CFG)

                if amount is not None:
                    self.client.buy(cheapest["address"], amount)

                    self.log(
                        f"{intensity.upper()} ARB BUY barato {cheapest['symbol']} | "
                        f"{amount} CASH | desvio={cheapest_deviation:+.2%} "
                        f"spread={spread:+.2%}"
                    )
                    return

        if most_expensive and expensive_deviation >= expensive_threshold:
            balance = self.product_balance(most_expensive["address"])
            amount, intensity = sell_amount(balance, _CFG)

            if amount is not None:
                self.client.sell(most_expensive["address"], amount)

                self.log(
                    f"{intensity.upper()} ARB SELL caro {most_expensive['symbol']} | "
                    f"{amount} | desvio={expensive_deviation:+.2%} "
                    f"spread={spread:+.2%}"
                )
                return

        self._exploratory_trade(pools)


if __name__ == "__main__":
    ArbitrageBot(
        private_key=os.getenv("BOT_ARBITRAGE_PK"),
        name="ArbitrageBot"
    ).run()