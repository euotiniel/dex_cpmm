import os
import random
from dotenv import load_dotenv

from bots.common.botBase import BaseBot
from bots.common.config import CONFIG

load_dotenv()
_CFG = CONFIG["market_maker"]

# Minimum product units to actually execute a sell (avoids dust sells)
_MIN_SELL_EXEC = 0.0001


class MarketMakerBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name, interval_key="market_maker")
        # Track buy prices per product to enable stop-loss exits
        self._buy_prices: dict = {}

    def small_buy_amount(self, cash):
        base = min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"])
        amount = round(base * random.uniform(0.7, 1.15), 4)

        if amount < _CFG["min_buy_amount"]:
            return None

        return amount

    def small_sell_amount(self, balance):
        if balance < _CFG["min_sell_balance"]:
            return None

        amount = round(balance * _CFG["sell_fraction"] * random.uniform(0.7, 1.15), 4)

        # Use a hard floor so the second check never silently blocks valid sells
        if amount < _MIN_SELL_EXEC:
            return None

        return amount

    def _record_buy(self, product_address: str, price: float):
        self._buy_prices[product_address] = price

    def exploratory_trade(self, pools):
        if random.random() > _CFG.get("explore_probability", 0.08):
            self.log("mercado dentro da banda")
            return

        target = random.choice(pools)
        symbol = target["symbol"]
        action = random.choice(["buy", "sell"])

        if action == "buy":
            cash = self.cash_balance()

            if cash < _CFG["min_cash"]:
                self.log("saldo CASH insuficiente para exploracao")
                return

            amount = self.small_buy_amount(cash)

            if amount is None:
                self.log("exploracao BUY ignorada")
                return

            self.client.buy(target["address"], amount)
            self._record_buy(target["address"], target["spot_price"])
            self.log(f"MM EXPLORATION BUY {symbol} | {amount} CASH")
            return

        balance = self.product_balance(target["address"])
        amount = self.small_sell_amount(balance)

        if amount is None:
            self.log("exploracao SELL ignorada")
            return

        self.client.sell(target["address"], amount)
        self.log(f"MM EXPLORATION SELL {symbol} | {amount}")

    def _check_stop_loss(self, pools):
        """Exit positions where price has fallen >4% below the recorded buy price."""
        stop_loss_pct = 0.04
        for pool in pools:
            addr = pool["address"]
            buy_px = self._buy_prices.get(addr)
            if buy_px is None or buy_px <= 0:
                continue
            current_px = pool["spot_price"]
            if current_px <= 0:
                continue
            if (buy_px - current_px) / buy_px >= stop_loss_pct:
                balance = self.product_balance(addr)
                amount = self.small_sell_amount(balance)
                if amount is not None:
                    self.client.sell(addr, amount)
                    del self._buy_prices[addr]
                    self.log(
                        f"MM STOP-LOSS SELL {pool['symbol']} | {amount} | "
                        f"buy={buy_px:.4f} now={current_px:.4f}"
                    )
                    return True
        return False

    def step(self):
        pools = self.client.get_all_pools()

        if not pools:
            self.log("sem pools")
            return

        # Check stop-loss exits first
        if self._check_stop_loss(pools):
            return

        anchor = _CFG["anchor_price"]

        most_underpriced = None
        most_overpriced = None
        biggest_discount = 0.0
        biggest_premium = 0.0

        for pool in pools:
            price = pool["spot_price"]

            if price <= 0:
                continue

            deviation = (price - anchor) / anchor

            if deviation < biggest_discount:
                biggest_discount = deviation
                most_underpriced = pool

            if deviation > biggest_premium:
                biggest_premium = deviation
                most_overpriced = pool

        buy_threshold = _CFG["buy_below_pct"] * random.uniform(0.85, 1.15)
        sell_threshold = _CFG["sell_above_pct"] * random.uniform(0.85, 1.15)

        if most_underpriced and abs(biggest_discount) >= buy_threshold:
            cash = self.cash_balance()

            if cash < _CFG["min_cash"]:
                self.log("saldo CASH insuficiente para MM BUY")
                return

            amount = self.small_buy_amount(cash)

            if amount is None:
                self.log("MM BUY ignorado por amount baixo")
                return

            self.client.buy(most_underpriced["address"], amount)
            self._record_buy(most_underpriced["address"], most_underpriced["spot_price"])
            self.log(
                f"MM BUY estabilizador {most_underpriced['symbol']} | "
                f"{amount} CASH | desvio={biggest_discount:+.2%}"
            )
            return

        if most_overpriced and biggest_premium >= sell_threshold:
            balance = self.product_balance(most_overpriced["address"])
            amount = self.small_sell_amount(balance)

            if amount is None:
                self.log("MM SELL ignorado por saldo baixo")
                return

            self.client.sell(most_overpriced["address"], amount)
            if most_overpriced["address"] in self._buy_prices:
                del self._buy_prices[most_overpriced["address"]]
            self.log(
                f"MM SELL estabilizador {most_overpriced['symbol']} | "
                f"{amount} | desvio={biggest_premium:+.2%}"
            )
            return

        self.exploratory_trade(pools)


if __name__ == "__main__":
    MarketMakerBot(
        private_key=os.getenv("BOT_MARKET_MAKER_PK"),
        name="MarketMakerBot"
    ).run()