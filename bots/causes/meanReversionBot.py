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
                token_in = pool["token0"]
                token_out = pool["token1"]
                symbol_in = pool["symbol0"]
                symbol_out = pool["symbol1"]
                action = "vendeu ativo esticado"
            else:
                token_in = pool["token1"]
                token_out = pool["token0"]
                symbol_in = pool["symbol1"]
                symbol_out = pool["symbol0"]
                action = "comprou ativo descontado"

            if self.should_ignore_signal():
                self.log(f"ignorou reversao em {pool['pair']} | mood={self.mood}")
                return

            amount = self.amount_from_balance(
                token_in,
                _CFG["trade_fraction"],
                _CFG["max_trade"],
                _CFG["min_balance"]
            )

            if amount is None:
                self.log(f"saldo insuficiente para reversao {symbol_in}->{symbol_out}")
                return

            self.swap(token_in, token_out, amount)

            self.log(
                f"MEAN REVERSION {pool['pair']} | {action} | "
                f"{amount} {symbol_in} -> {symbol_out} | change={change:+.2%} | mood={self.mood}"
            )
            return

        self.log(f"sem sinal de reversao | mood={self.mood}")


if __name__ == "__main__":
    MeanReversionBot(
        private_key=os.getenv("BOT_MEAN_REVERSION_PK"),
        name="MeanReversionBot"
    ).run()