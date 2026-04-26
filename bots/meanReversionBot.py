import os
import random
from dotenv import load_dotenv

from bots.common.botBase import BaseBot
from bots.common.config import CONFIG
from bots.common.human_behavior import HumanBehavior

load_dotenv()
_CFG = CONFIG["mean_reversion"]


class MeanReversionBot(BaseBot, HumanBehavior):
    def __init__(self, private_key: str, name: str):
        BaseBot.__init__(self, private_key, name, interval_key="mean_reversion")
        HumanBehavior.__init__(self)
        self.last_prices = {}

    def step(self):
        self.update_mood()

        pools = self.client.get_all_pools()
        random.shuffle(pools)

        chosen_buy = None
        chosen_sell = None
        biggest_drop = 0.0
        biggest_rise = 0.0

        for pool in pools:
            address = pool["address"]
            current_price = pool["spot_price"]
            previous_price = self.last_prices.get(address)

            self.last_prices[address] = self.noisy_price(current_price)

            if previous_price is None or previous_price == 0:
                continue

            variation = (current_price - previous_price) / previous_price
            variation += random.uniform(-0.004, 0.004)

            if variation < biggest_drop:
                biggest_drop = variation
                chosen_buy = pool

            if variation > biggest_rise:
                biggest_rise = variation
                chosen_sell = pool

        cash = self.cash_balance()

        drop_threshold = self.noisy_threshold(_CFG["drop_threshold"])
        rise_threshold = self.noisy_threshold(_CFG["rise_threshold"])

        if chosen_buy and biggest_drop < -drop_threshold and cash > _CFG["min_cash"]:
            if self.should_ignore_signal():
                self.log(f"ignorou queda forte {chosen_buy['symbol']} | mood={self.mood}")
                return

            base = min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"])
            amount = self.human_amount(base, 1)

            self.client.buy(chosen_buy["address"], amount)
            self.log(
                f"queda forte {chosen_buy['symbol']} ({biggest_drop:+.2%}) | "
                f"BUY por reversao {amount} CASH | mood={self.mood}"
            )
            return

        if chosen_sell and biggest_rise > rise_threshold:
            balance = self.product_balance(chosen_sell["address"])

            if balance > _CFG["min_sell_balance"]:
                if self.should_ignore_signal():
                    self.log(f"ignorou alta forte {chosen_sell['symbol']} | mood={self.mood}")
                    return

                base = balance * _CFG["sell_fraction"]
                amount = self.human_amount(base, _CFG["min_sell_balance"])

                self.client.sell(chosen_sell["address"], amount)
                self.log(
                    f"alta forte {chosen_sell['symbol']} ({biggest_rise:+.2%}) | "
                    f"SELL por reversao {amount} | mood={self.mood}"
                )
                return

        if self.should_do_random_trade():
            product = self.random_product()
            symbol = self.client.get_product_symbol(product)

            if random.choice(["buy", "sell"]) == "buy":
                cash = self.cash_balance()
                if cash > _CFG["min_cash"]:
                    amount = self.human_amount(min(_CFG["max_buy_cash"], cash * 0.18), 1)
                    self.client.buy(product, amount)
                    self.log(f"decisao emocional BUY {symbol} | {amount} | mood={self.mood}")
                    return
            else:
                balance = self.product_balance(product)
                if balance > _CFG["min_sell_balance"]:
                    amount = self.human_amount(balance * 0.35, _CFG["min_sell_balance"])
                    self.client.sell(product, amount)
                    self.log(f"decisao emocional SELL {symbol} | {amount} | mood={self.mood}")
                    return

        self.log(f"sem sinal de reversao | mood={self.mood}")


if __name__ == "__main__":
    MeanReversionBot(private_key=os.getenv("BOT_MEAN_REVERSION_PK"), name="MeanReversionBot").run()