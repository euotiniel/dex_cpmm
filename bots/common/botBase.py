import random
import time
from abc import ABC, abstractmethod

from bots.common.dexClient import DexClient


class BaseBot(ABC):
    def __init__(self, private_key: str, name: str):
        self.client = DexClient(private_key)
        self.name = name

    def random_product(self) -> str:
        return random.choice(self.client.product_addresses)

    def cash_balance(self) -> float:
        return self.client.get_cash_balance()

    def product_balance(self, product_address: str) -> float:
        return self.client.get_product_balance(product_address)

    def sleep_random(self, min_seconds: int, max_seconds: int):
        time.sleep(random.randint(min_seconds, max_seconds))

    def log(self, message: str):
        print(f"[{self.name}] {message}")

    @abstractmethod
    def step(self):
        pass

    def run(self):
        self.log(f"wallet={self.client.address}")
        self.client.wait_until_active()
        self.log("competicao ativa, iniciando estrategia")

        while True:
            status = self.client.get_competition_status()
            if status["status"] == 2:
                self.log("competicao encerrada")
                break

            try:
                self.step()
            except Exception as error:
                self.log(f"erro: {error}")

            self.sleep_random(2, 5)