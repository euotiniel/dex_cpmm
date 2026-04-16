import os

from dotenv import load_dotenv
from bots.common.botBase import BaseBot

load_dotenv()


class MeanReversionBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name)
        self.last_prices = {}

    def step(self):
        pools = self.client.get_all_pools()

        chosen_buy = None
        chosen_sell = None
        biggest_drop = 0
        biggest_rise = 0

        for pool in pools:
            address = pool["address"]
            current_price = pool["spot_price"]
            previous_price = self.last_prices.get(address)

            self.last_prices[address] = current_price

            if previous_price is None or previous_price == 0:
                continue

            variation = (current_price - previous_price) / previous_price

            if variation < biggest_drop:
                biggest_drop = variation
                chosen_buy = pool

            if variation > biggest_rise:
                biggest_rise = variation
                chosen_sell = pool

        cash = self.cash_balance()

        if chosen_buy and biggest_drop < -0.015 and cash > 10:
            amount = round(min(25, cash * 0.18), 4)
            self.client.buy(chosen_buy["address"], amount)
            self.log(f"queda forte em {chosen_buy['symbol']}, BUY por reversao com {amount} CASH")
            return

        if chosen_sell:
            balance = self.product_balance(chosen_sell["address"])
            if biggest_rise > 0.015 and balance > 0.02:
                amount = round(min(balance * 0.4, balance), 4)
                self.client.sell(chosen_sell["address"], amount)
                self.log(f"alta forte em {chosen_sell['symbol']}, SELL por reversao com {amount}")
                return

        self.log("sem sinal de reversao")


if __name__ == "__main__":
    bot = MeanReversionBot(
        private_key=os.getenv("BOT_MEAN_REVERSION_PK"),
        name="MeanReversionBot",
    )
    bot.run()