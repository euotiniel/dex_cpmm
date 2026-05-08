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

    def weight_multiplier(self, symbol_in, symbol_out):
        weights = self.client.get_grading_weights()

        w_in = weights.get(symbol_in, 0)
        w_out = weights.get(symbol_out, 0)

        diff = w_out - w_in

        if w_out >= 60:
            return random.uniform(1.2, 1.55)

        if diff >= 30:
            return random.uniform(1.05, 1.35)

        if diff <= -40:
            return random.uniform(0.25, 0.55)

        if diff <= -20:
            return random.uniform(0.45, 0.75)

        return random.uniform(0.75, 1.1)

    def should_take_reversion(self, symbol_in, symbol_out, change):
        weights = self.client.get_grading_weights()

        w_in = weights.get(symbol_in, 0)
        w_out = weights.get(symbol_out, 0)

        # ReversionBot é mais paciente: compra token de peso alto quando há desconto.
        if w_out >= 60:
            return True

        if w_out > w_in:
            return random.random() < 0.85

        if abs(change) >= _CFG["threshold"] * 3:
            return random.random() < 0.45

        return random.random() < 0.20

    def step(self):
        self.update_mood()

        pools = self.pools()
        random.shuffle(pools)

        for pool in pools:
            key = pool["pool_id"].hex() if hasattr(pool["pool_id"], "hex") else str(pool["pool_id"])
            current = pool["price01"]
            previous = self.last_prices.get(key)

            self.last_prices[key] = self.noisy_price(current)

            if previous is None or previous <= 0:
                continue

            change = (current - previous) / previous
            threshold = self.noisy_threshold(_CFG["threshold"])

            if abs(change) < threshold:
                continue

            if change > 0:
                # token0 esticou; vende token0 e compra token1,
                # salvo se token0 for muito importante.
                token_in = pool["token0"]
                token_out = pool["token1"]
                symbol_in = pool["symbol0"]
                symbol_out = pool["symbol1"]
                action = "vendeu ativo esticado"
            else:
                # token0 caiu; compra token0 usando token1.
                token_in = pool["token1"]
                token_out = pool["token0"]
                symbol_in = pool["symbol1"]
                symbol_out = pool["symbol0"]
                action = "comprou ativo descontado"

            if not self.should_take_reversion(symbol_in, symbol_out, change):
                self.log(
                    f"reversao ignorada por peso {symbol_in}->{symbol_out} | "
                    f"change={change:+.2%} | mood={self.mood}"
                )
                return

            if self.should_ignore_signal():
                self.log(f"ignorou reversao em {pool['pair']} | mood={self.mood}")
                return

            fraction = _CFG["trade_fraction"] * self.weight_multiplier(symbol_in, symbol_out)

            amount = self.amount_from_balance(
                token_in,
                fraction,
                _CFG["max_trade"],
                _CFG["min_balance"]
            )

            if amount is None:
                self.log(f"saldo insuficiente para reversao {symbol_in}->{symbol_out}")
                return

            self.swap(token_in, token_out, amount)

            weights = self.client.get_grading_weights()

            self.log(
                f"MEAN REVERSION WEIGHTED {pool['pair']} | {action} | "
                f"{amount} {symbol_in}->{symbol_out} | "
                f"change={change:+.2%} | peso {symbol_out}={weights.get(symbol_out, 0)}% | mood={self.mood}"
            )
            return

        self.log(f"sem sinal de reversao | mood={self.mood}")


if __name__ == "__main__":
    MeanReversionBot(
        private_key=os.getenv("BOT_MEAN_REVERSION_PK"),
        name="MeanReversionBot"
    ).run()