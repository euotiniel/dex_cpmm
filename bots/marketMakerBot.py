import os
import random
from collections import deque
from dotenv import load_dotenv

from bots.common.botBase import BaseBot
from bots.common.config import CONFIG

load_dotenv()
_CFG = CONFIG["market_maker"]

_MIN_SELL_EXEC = 0.0001


class MarketMakerBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name, interval_key="market_maker")
        self.price_windows = {}
        self.buy_prices = {}

    def _remember_price(self, address, price):
        if address not in self.price_windows:
            self.price_windows[address] = deque(maxlen=8)

        if price > 0:
            self.price_windows[address].append(price)

    def _fair_price(self, address, fallback):
        prices = self.price_windows.get(address)

        if not prices or len(prices) < 3:
            return fallback

        return sum(prices) / len(prices)

    def small_buy_amount(self, cash):
        base = min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"])
        amount = round(base * random.uniform(0.65, 1.10), 4)

        if amount < _CFG["min_buy_amount"]:
            return None

        return amount

    def small_sell_amount(self, balance):
        if balance < _CFG["min_sell_balance"]:
            return None

        amount = round(balance * _CFG["sell_fraction"] * random.uniform(0.65, 1.10), 4)

        if amount < _MIN_SELL_EXEC:
            return None

        return amount

    def _record_buy(self, product_address, price):
        self.buy_prices[product_address] = price

    def _check_stop_loss(self, pools):
        stop_loss_pct = _CFG.get("stop_loss_pct", 0.04)

        for pool in pools:
            address = pool["address"]
            buy_price = self.buy_prices.get(address)

            if buy_price is None or buy_price <= 0:
                continue

            current_price = pool["spot_price"]

            if current_price <= 0:
                continue

            loss = (buy_price - current_price) / buy_price

            if loss < stop_loss_pct:
                continue

            balance = self.product_balance(address)
            amount = self.small_sell_amount(balance)

            if amount is None:
                continue

            self.client.sell(address, amount)
            del self.buy_prices[address]

            self.log(
                f"MM STOP-LOSS SELL {pool['symbol']} | {amount} | "
                f"buy={buy_price:.4f} now={current_price:.4f} loss={loss:+.2%}"
            )
            return True

        return False

    def _inventory_rebalance(self, pools):
        """
        Mantém o bot ativo mesmo quando o preço está lateral.
        Se tiver muito CASH, compra pequeno.
        Se tiver muito inventário, vende pequeno.
        """
        if random.random() > _CFG.get("rebalance_probability", 0.20):
            return False

        target = random.choice(pools)
        address = target["address"]
        symbol = target["symbol"]

        cash = self.cash_balance()
        balance = self.product_balance(address)

        prefer_buy = cash > _CFG["min_cash"] and random.random() < 0.60

        if prefer_buy:
            amount = self.small_buy_amount(cash)

            if amount is None:
                return False

            self.client.buy(address, amount)
            self._record_buy(address, target["spot_price"])
            self.log(f"MM REBALANCE BUY {symbol} | {amount} CASH")
            return True

        amount = self.small_sell_amount(balance)

        if amount is None:
            return False

        self.client.sell(address, amount)
        self.log(f"MM REBALANCE SELL {symbol} | {amount}")
        return True

    def step(self):
        pools = self.client.get_all_pools()

        if not pools:
            self.log("sem pools")
            return

        for pool in pools:
            self._remember_price(pool["address"], pool["spot_price"])

        if self._check_stop_loss(pools):
            return

        best_buy = None
        best_sell = None
        best_discount = 0.0
        best_premium = 0.0

        for pool in pools:
            address = pool["address"]
            price = pool["spot_price"]

            if price <= 0:
                continue

            fair_price = self._fair_price(address, price)

            if fair_price <= 0:
                continue

            deviation = (price - fair_price) / fair_price

            if deviation < best_discount:
                best_discount = deviation
                best_buy = pool

            if deviation > best_premium:
                best_premium = deviation
                best_sell = pool

        buy_threshold = _CFG["buy_below_pct"] * random.uniform(0.80, 1.20)
        sell_threshold = _CFG["sell_above_pct"] * random.uniform(0.80, 1.20)

        if best_buy and abs(best_discount) >= buy_threshold:
            cash = self.cash_balance()

            if cash < _CFG["min_cash"]:
                self.log("saldo CASH insuficiente para MM BUY")
                return

            amount = self.small_buy_amount(cash)

            if amount is None:
                self.log("MM BUY ignorado por amount baixo")
                return

            self.client.buy(best_buy["address"], amount)
            self._record_buy(best_buy["address"], best_buy["spot_price"])

            self.log(
                f"MM BUY suporte {best_buy['symbol']} | {amount} CASH | "
                f"desvio={best_discount:+.2%}"
            )
            return

        if best_sell and best_premium >= sell_threshold:
            balance = self.product_balance(best_sell["address"])
            amount = self.small_sell_amount(balance)

            if amount is None:
                self.log("MM SELL ignorado por saldo baixo")
            else:
                self.client.sell(best_sell["address"], amount)

                if best_sell["address"] in self.buy_prices:
                    del self.buy_prices[best_sell["address"]]

                self.log(
                    f"MM SELL resistencia {best_sell['symbol']} | {amount} | "
                    f"desvio={best_premium:+.2%}"
                )
                return

        if self._inventory_rebalance(pools):
            return

        self.log("MM mercado equilibrado")


if __name__ == "__main__":
    MarketMakerBot(
        private_key=os.getenv("BOT_MARKET_MAKER_PK"),
        name="MarketMakerBot"
    ).run()