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

    def find_target_by_weight(self):
        weights = self.client.get_grading_weights()
        pools = self.pools()

        best = None
        best_score = -999

        for pool in pools:
            w0 = weights.get(pool["symbol0"], 0)
            w1 = weights.get(pool["symbol1"], 0)

            if w0 == w1:
                continue

            if w0 > w1:
                token_to_sell = pool["token1"]
                token_to_buy = pool["token0"]
                sell_symbol = pool["symbol1"]
                buy_symbol = pool["symbol0"]
                score = w0 - w1
            else:
                token_to_sell = pool["token0"]
                token_to_buy = pool["token1"]
                sell_symbol = pool["symbol0"]
                buy_symbol = pool["symbol1"]
                score = w1 - w0

            if score > best_score:
                best_score = score
                best = {
                    **pool,
                    "score": score,
                    "token_to_sell": token_to_sell,
                    "token_to_buy": token_to_buy,
                    "sell_symbol": sell_symbol,
                    "buy_symbol": buy_symbol,
                    "mode": "weight_pressure"
                }

        return best

    def find_top_gainer_pair(self):
        best = None
        best_gain = -999
        weights = self.client.get_grading_weights()

        for pool in self.pools():
            initial = self._remember_initial(pool)

            if initial <= 0:
                continue

            gain = (pool["price01"] - initial) / initial

            # Se token0 subiu, vender token0 para comprar token1 só faz sentido
            # se token0 não tiver peso dominante.
            w0 = weights.get(pool["symbol0"], 0)
            w1 = weights.get(pool["symbol1"], 0)

            if gain > best_gain:
                if w0 >= 60 and w0 > w1:
                    continue

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
        weights = self.client.get_grading_weights()

        if not pools:
            return None

        pool = random.choice(pools)

        w0 = weights.get(pool["symbol0"], 0)
        w1 = weights.get(pool["symbol1"], 0)

        if w0 > w1 and random.random() < 0.7:
            return {
                **pool,
                "gain": 0,
                "token_to_sell": pool["token1"],
                "token_to_buy": pool["token0"],
                "sell_symbol": pool["symbol1"],
                "buy_symbol": pool["symbol0"],
                "mode": "random_weighted"
            }

        if w1 > w0 and random.random() < 0.7:
            return {
                **pool,
                "gain": 0,
                "token_to_sell": pool["token0"],
                "token_to_buy": pool["token1"],
                "sell_symbol": pool["symbol0"],
                "buy_symbol": pool["symbol1"],
                "mode": "random_weighted"
            }

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
        weights = self.client.get_grading_weights()

        if weights:
            max_weight = max(weights.values())

            if max_weight >= 60 and random.random() < 0.75:
                target = self.find_target_by_weight()
                if target:
                    return target

        if random.random() < _CFG.get("random_side_probability", 0.45):
            return self.random_target()

        target = self.find_top_gainer_pair()
        return target or self.find_target_by_weight() or self.random_target()

    def sell_fraction_by_weight(self, sell_symbol, buy_symbol):
        weights = self.client.get_grading_weights()

        w_sell = weights.get(sell_symbol, 0)
        w_buy = weights.get(buy_symbol, 0)

        fraction = _CFG["sell_fraction"]

        if w_buy >= 60:
            fraction *= random.uniform(1.4, 2.0)

        elif w_buy > w_sell:
            fraction *= random.uniform(1.1, 1.45)

        if w_sell >= 50:
            fraction *= random.uniform(0.25, 0.55)

        if w_sell == 0 and w_buy > 0:
            fraction *= random.uniform(1.3, 1.8)

        return fraction

    def step(self):
        self.update_mood()

        if random.random() > _CFG["pressure_probability"]:
            self.log(f"sem choque neste ciclo | mood={self.mood}")
            return

        target = self.choose_target()

        if not target:
            self.log("sem alvo de choque")
            return

        sell_fraction = self.sell_fraction_by_weight(
            target["sell_symbol"],
            target["buy_symbol"]
        )

        if random.random() < _CFG["hard_dump_probability"]:
            sell_fraction *= random.uniform(1.4, 2.2)

        if self.mood == "impulsive":
            sell_fraction *= random.uniform(1.05, 1.35)

        if self.mood == "fearful":
            sell_fraction *= random.uniform(0.65, 0.95)

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

        weights = self.client.get_grading_weights()

        self.log(
            f"SHOCK WEIGHTED {amount} {target['sell_symbol']}->{target['buy_symbol']} | "
            f"mode={target['mode']} | "
            f"peso {target['sell_symbol']}={weights.get(target['sell_symbol'], 0)}% / "
            f"{target['buy_symbol']}={weights.get(target['buy_symbol'], 0)}% | mood={self.mood}"
        )


if __name__ == "__main__":
    ShockBot(
        private_key=os.getenv("BOT_SHOCK_PK"),
        name="ShockBot"
    ).run()