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

    def _pool_key(self, pool):
        return pool["pool_id"].hex() if hasattr(pool["pool_id"], "hex") else str(pool["pool_id"])

    def _remember_initial(self, pool):
        key = self._pool_key(pool)

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
                    "buy_symbol": pool["symbol1"],
                    "mode": "top_gainer"
                }

        return best

    def random_target(self):
        pools = self.pools()

        if not pools:
            return None

        pool = random.choice(pools)

        if random.random() < 0.5:
            return {
                **pool,
                "gain": 0,
                "token_to_sell": pool["token0"],
                "token_to_buy": pool["token1"],
                "sell_symbol": pool["symbol0"],
                "buy_symbol": pool["symbol1"],
                "mode": "random"
            }

        return {
            **pool,
            "gain": 0,
            "token_to_sell": pool["token1"],
            "token_to_buy": pool["token0"],
            "sell_symbol": pool["symbol1"],
            "buy_symbol": pool["symbol0"],
            "mode": "random"
        }

    def choose_target(self):
        # Parte aleatória: evita que o ShockBot seja sempre "inteligente"
        # e favorecido pelo sistema.
        if random.random() < _CFG.get("random_side_probability", 0.45):
            return self.random_target()

        # Parte direcional: ainda permite choque sobre o ativo mais esticado.
        return self.find_top_gainer_pair()

    def step(self):
        self.update_mood()

        if random.random() > _CFG["pressure_probability"]:
            self.log(f"sem choque neste ciclo | mood={self.mood}")
            return

        target = self.choose_target()

        if not target:
            self.log("sem alvo de choque")
            return

        sell_fraction = _CFG["sell_fraction"]

        if random.random() < _CFG["hard_dump_probability"]:
            sell_fraction = random.uniform(0.45, 0.7)

        if self.mood == "impulsive":
            sell_fraction *= random.uniform(1.05, 1.3)

        if self.mood == "fearful":
            sell_fraction *= random.uniform(0.75, 1.05)

        amount = self.amount_from_balance(
            target["token_to_sell"],
            sell_fraction,
            _CFG["max_trade"],
            _CFG["min_balance"]
        )

        if amount is None:
            self.log(f"sem saldo para choque em {target['sell_symbol']} | mood={self.mood}")
            return

        self.swap(target["token_to_sell"], target["token_to_buy"], amount)

        if target["mode"] == "top_gainer":
            self.log(
                f"SHOCK SELL {amount} {target['sell_symbol']} -> {target['buy_symbol']} | "
                f"gainer={target['gain']:+.2%} | mode=top_gainer | mood={self.mood}"
            )
        else:
            self.log(
                f"RANDOM SHOCK {amount} {target['sell_symbol']} -> {target['buy_symbol']} | "
                f"mode=random | mood={self.mood}"
            )


if __name__ == "__main__":
    ShockBot(
        private_key=os.getenv("BOT_SHOCK_PK"),
        name="ShockBot"
    ).run()