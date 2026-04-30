import random
import time
from abc import ABC, abstractmethod

from bots.common.dexClient import DexClient
from bots.common.config import CONFIG


class BaseBot(ABC):
    def __init__(self, private_key: str, name: str, interval_key: str):
        self.client = DexClient(private_key)
        self.name = name

        interval = CONFIG["intervals"].get(interval_key, [2, 5])
        self._min_interval = interval[0]
        self._max_interval = interval[1]

    def log(self, message: str):
        print(f"[{self.name}] {message}", flush=True)

    def sleep_random(self):
        time.sleep(random.uniform(self._min_interval, self._max_interval))

    def pools(self):
        return self.client.get_all_pools()

    def random_pool(self):
        pools = self.pools()
        if not pools:
            return None
        return random.choice(pools)

    def balance(self, token_address: str) -> float:
        return self.client.get_balance(token_address)

    def swap(self, token_in: str, token_out: str, amount: float):
        return self.client.swap(token_in, token_out, amount)

    def amount_from_balance(self, token_address: str, fraction: float, max_amount: float, min_amount: float):
        balance = self.balance(token_address)

        if balance <= min_amount:
            return None

        amount = min(max_amount, balance * fraction)
        amount = round(amount * random.uniform(0.55, 1.15), 4)

        if amount <= min_amount:
            return None

        return amount

    @abstractmethod
    def step(self):
        pass

    def run(self):
        self.log(f"wallet={self.client.address}")

        while True:
            self.client.wait_until_active()
            self.log("competition active — starting strategy")

            while True:
                try:
                    status = self.client.get_competition_status()
                except Exception as e:
                    self.log(f"status check error: {e}")
                    time.sleep(2)
                    continue

                if status["status"] != 1:
                    self.log("competition ended — waiting")
                    break

                try:
                    self.step()
                except Exception as e:
                    self.log(f"step error: {e}")

                self.sleep_random()