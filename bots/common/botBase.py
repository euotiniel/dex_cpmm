import random
import time
from abc import ABC, abstractmethod

from bots.common.dexClient import DexClient
from bots.common.config import CONFIG as _CONFIG


class BaseBot(ABC):
    def __init__(self, private_key: str, name: str, interval_key: str = "noise"):
        self.client = DexClient(private_key)
        self.name = name
        _iv = _CONFIG["intervals"].get(interval_key, [2, 5])
        self._min_interval = _iv[0]
        self._max_interval = _iv[1]

    def random_product(self) -> str:
        return random.choice(self.client.product_addresses)

    def cash_balance(self) -> float:
        return self.client.get_cash_balance()

    def product_balance(self, product_address: str) -> float:
        return self.client.get_product_balance(product_address)

    def sleep_random(self):
        time.sleep(random.uniform(self._min_interval, self._max_interval))

    def log(self, message: str):
        print(f"[{self.name}] {message}", flush=True)

    @abstractmethod
    def step(self):
        pass

    def run(self):
        self.log(f"wallet={self.client.address}")
        self.client.wait_until_active()
        self.log("competicao ativa — iniciando estrategia")

        while True:
            status = self.client.get_competition_status()
            if status["status"] == 2:
                self.log("competicao encerrada")
                break

            try:
                self.step()
            except Exception as error:
                self.log(f"erro no step: {error}")

            self.sleep_random()
