import os
from dotenv import load_dotenv
from bots.common.botBase import BaseBot
from bots.common.config import CONFIG

load_dotenv()
_CFG = CONFIG["mean_reversion"]


class MeanReversionBot(BaseBot):
    def __init__(self, private_key: str, name: str):
        super().__init__(private_key, name, interval_key="mean_reversion")
        self.last_prices: dict = {}

    def step(self):
        pools = self.client.get_all_pools()

        chosen_buy = None
        chosen_sell = None
        biggest_drop = 0.0
        biggest_rise = 0.0

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

        if chosen_buy and biggest_drop < -_CFG["drop_threshold"] and cash > _CFG["min_cash"]:
            amount = round(min(_CFG["max_buy_cash"], cash * _CFG["buy_fraction"]), 4)
            self.client.buy(chosen_buy["address"], amount)
            self.log(f"queda forte {chosen_buy['symbol']} ({biggest_drop:+.2%}) | BUY por reversao {amount} CASH")
            return

        if chosen_sell and biggest_rise > _CFG["rise_threshold"]:
            balance = self.product_balance(chosen_sell["address"])
            if balance > _CFG["min_sell_balance"]:
                amount = round(balance * _CFG["sell_fraction"], 4)
                self.client.sell(chosen_sell["address"], amount)
                self.log(f"alta forte {chosen_sell['symbol']} ({biggest_rise:+.2%}) | SELL por reversao {amount}")
                return

        self.log("sem sinal de reversao")


if __name__ == "__main__":
    MeanReversionBot(private_key=os.getenv("BOT_MEAN_REVERSION_PK"), name="MeanReversionBot").run()
