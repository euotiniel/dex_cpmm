import os
import time
from typing import Dict, List, Any

from dotenv import load_dotenv
from web3 import Web3

load_dotenv()

EXCHANGE_ABI = [
    {
        "inputs": [],
        "name": "baseToken",
        "outputs": [{"internalType": "contract IERC20", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "getProductTokens",
        "outputs": [{"internalType": "address[]", "name": "", "type": "address[]"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "address", "name": "productToken", "type": "address"}],
        "name": "getPool",
        "outputs": [
            {"internalType": "bool", "name": "exists", "type": "bool"},
            {"internalType": "address", "name": "token", "type": "address"},
            {"internalType": "uint256", "name": "reserveBase", "type": "uint256"},
            {"internalType": "uint256", "name": "reserveProduct", "type": "uint256"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "address", "name": "productToken", "type": "address"}],
        "name": "getSpotPrice",
        "outputs": [{"internalType": "uint256", "name": "priceInBase", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "getCompetitionStatus",
        "outputs": [
            {"internalType": "uint8", "name": "status", "type": "uint8"},
            {"internalType": "uint256", "name": "startTime", "type": "uint256"},
            {"internalType": "uint256", "name": "endTime", "type": "uint256"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "productToken", "type": "address"},
            {"internalType": "uint256", "name": "baseAmountIn", "type": "uint256"},
        ],
        "name": "buy",
        "outputs": [{"internalType": "uint256", "name": "productAmountOut", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "productToken", "type": "address"},
            {"internalType": "uint256", "name": "productAmountIn", "type": "uint256"},
        ],
        "name": "sell",
        "outputs": [{"internalType": "uint256", "name": "baseAmountOut", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

ERC20_ABI = [
    {
        "inputs": [{"internalType": "address", "name": "owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "symbol",
        "outputs": [{"internalType": "string", "name": "", "type": "string"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "decimals",
        "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "owner", "type": "address"},
            {"internalType": "address", "name": "spender", "type": "address"},
        ],
        "name": "allowance",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "spender", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]


class DexClient:
    def __init__(self, private_key: str):
        self.rpc_url = os.getenv("RPC_URL")
        self.exchange_address = Web3.to_checksum_address(os.getenv("EXCHANGE_ADDRESS"))
        self.cash_address = Web3.to_checksum_address(os.getenv("CASH_ADDRESS"))

        self.w3 = Web3(Web3.HTTPProvider(self.rpc_url))
        if not self.w3.is_connected():
            raise RuntimeError("Nao foi possivel conectar ao RPC")

        self.account = self.w3.eth.account.from_key(private_key)
        self.address = self.account.address
        self.private_key = private_key

        self.exchange = self.w3.eth.contract(
            address=self.exchange_address,
            abi=EXCHANGE_ABI,
        )

        self.cash_token = self.w3.eth.contract(
            address=self.cash_address,
            abi=ERC20_ABI,
        )

        self.product_addresses = [
            Web3.to_checksum_address(os.getenv("PROD1_ADDRESS")),
            Web3.to_checksum_address(os.getenv("PROD2_ADDRESS")),
            Web3.to_checksum_address(os.getenv("PROD3_ADDRESS")),
            Web3.to_checksum_address(os.getenv("PROD4_ADDRESS")),
            Web3.to_checksum_address(os.getenv("PROD5_ADDRESS")),
        ]

        self.product_tokens: Dict[str, Any] = {}
        for address in self.product_addresses:
            self.product_tokens[address] = self.w3.eth.contract(address=address, abi=ERC20_ABI)

    def _build_and_send_transaction(self, tx_function):
        nonce = self.w3.eth.get_transaction_count(self.address)
        gas_price = self.w3.eth.gas_price

        transaction = tx_function.build_transaction({
            "from": self.address,
            "nonce": nonce,
            "gas": 500000,
            "gasPrice": gas_price,
        })

        signed_tx = self.w3.eth.account.sign_transaction(transaction, private_key=self.private_key)
        tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)

        return receipt

    def get_competition_status(self) -> Dict[str, int]:
        status, start_time, end_time = self.exchange.functions.getCompetitionStatus().call()
        return {
            "status": int(status),
            "start_time": int(start_time),
            "end_time": int(end_time),
        }

    def wait_until_active(self, interval_seconds: int = 2):
        while True:
            data = self.get_competition_status()
            if data["status"] == 1:
                return
            if data["status"] == 2:
                raise RuntimeError("A competicao ja terminou")
            print(f"[{self.address}] competicao ainda nao iniciou")
            time.sleep(interval_seconds)

    def get_cash_balance(self) -> float:
        raw_balance = self.cash_token.functions.balanceOf(self.address).call()
        decimals = self.cash_token.functions.decimals().call()
        return raw_balance / (10 ** decimals)

    def get_product_balance(self, product_address: str) -> float:
        token = self.product_tokens[product_address]
        raw_balance = token.functions.balanceOf(self.address).call()
        decimals = token.functions.decimals().call()
        return raw_balance / (10 ** decimals)

    def get_all_product_balances(self) -> Dict[str, float]:
        balances = {}
        for product_address in self.product_addresses:
            balances[product_address] = self.get_product_balance(product_address)
        return balances

    def get_product_symbol(self, product_address: str) -> str:
        return self.product_tokens[product_address].functions.symbol().call()

    def get_pool(self, product_address: str) -> Dict[str, float]:
        exists, _, reserve_base, reserve_product = self.exchange.functions.getPool(product_address).call()
        price_raw = self.exchange.functions.getSpotPrice(product_address).call()

        token = self.product_tokens[product_address]
        decimals = token.functions.decimals().call()

        return {
            "exists": exists,
            "reserve_base": reserve_base / (10 ** 18),
            "reserve_product": reserve_product / (10 ** decimals),
            "spot_price": price_raw / (10 ** 18),
        }

    def get_all_pools(self) -> List[Dict[str, Any]]:
        pools = []
        for product_address in self.product_addresses:
            pool = self.get_pool(product_address)
            pool["address"] = product_address
            pool["symbol"] = self.get_product_symbol(product_address)
            pools.append(pool)
        return pools

    def ensure_approval(self, token_contract, spender: str, amount_wei: int):
        current_allowance = token_contract.functions.allowance(self.address, spender).call()
        if current_allowance >= amount_wei:
            return

        receipt = self._build_and_send_transaction(
            token_contract.functions.approve(spender, amount_wei)
        )
        print(f"[{self.address}] approve confirmado: {receipt.transactionHash.hex()}")

    def buy(self, product_address: str, amount_in_base: float):
        amount_wei = self.w3.to_wei(amount_in_base, "ether")
        self.ensure_approval(self.cash_token, self.exchange_address, amount_wei)

        receipt = self._build_and_send_transaction(
            self.exchange.functions.buy(product_address, amount_wei)
        )

        print(f"[{self.address}] BUY {self.get_product_symbol(product_address)} | "
              f"base_in={amount_in_base} | tx={receipt.transactionHash.hex()}")

        return receipt

    def sell(self, product_address: str, amount_in_product: float):
        token = self.product_tokens[product_address]
        decimals = token.functions.decimals().call()
        amount_wei = int(amount_in_product * (10 ** decimals))

        self.ensure_approval(token, self.exchange_address, amount_wei)

        receipt = self._build_and_send_transaction(
            self.exchange.functions.sell(product_address, amount_wei)
        )

        print(f"[{self.address}] SELL {self.get_product_symbol(product_address)} | "
              f"product_in={amount_in_product} | tx={receipt.transactionHash.hex()}")

        return receipt