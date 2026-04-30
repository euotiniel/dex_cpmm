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

    def _remember_initial(self, pool):
        key = pool["pool_id"].hex() if hasattr(pool["pool_id"], "hex") else str(pool["pool_id"])

        if key not in self.initial_prices:
            self.initial_prices[key] = pool["price01"]

        return self.initial_prices[key]

    def find_top_gainer_pair(self):
        best = None
        best_gain = -999

        for pool in self.pools():
            initial = self._remember_initial(pool)

            if initial <= 0:
                continue

            gain = (pool["price01"] - initial) / initial

            if gain > best_gain:
                best_gain = gain
                best = {
                    **pool,
                    "gain": gain,
                    "token_to_sell": pool["token0"],
                    "token_to_buy": pool["token1"],
                    "sell_symbol": pool["symbol0"],
                    "buy_symbol": pool["symbol1"]
                }

        return best

    def step(self):
        self.update_mood()

        target = self.find_top_gainer_pair()

        if not target:
            self.log("sem alvo de choque")
            return

        probability = _CFG["pressure_probability"]

        if random.random() > probability:
            self.log(f"sem choque neste ciclo | mood={self.mood}")
            return

        sell_fraction = _CFG["sell_fraction"]

        if random.random() < _CFG["hard_dump_probability"]:
            sell_fraction = random.uniform(0.65, 0.95)

        amount = self.amount_from_balance(
            target["token_to_sell"],
            sell_fraction,
            _CFG["max_trade"],
            _CFG["min_balance"]
        )

        if amount is None:
            self.log(f"sem saldo para vender {target['sell_symbol']}")
            return

        self.swap(target["token_to_sell"], target["token_to_buy"], amount)

        self.log(
            f"SHOCK SELL {amount} {target['sell_symbol']} -> {target['buy_symbol']} | "
            f"gainer={target['gain']:+.2%} | mood={self.mood}"
        )


if __name__ == "__main__":
    ShockBot(
        private_key=os.getenv("BOT_SHOCK_PK"),
        name="ShockBot"
    ).run()