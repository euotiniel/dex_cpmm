import os
import time
from typing import Dict, List, Any

from dotenv import load_dotenv
from web3 import Web3

from bots.common.config import CONFIG

load_dotenv()

_SLIPPAGE_PCT = CONFIG["slippage"]["max_price_impact_pct"]
_RETRY_MAX    = CONFIG["retry"]["max_attempts"]
_RETRY_DELAY  = CONFIG["retry"]["delay_seconds"]

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
        "inputs": [
            {"internalType": "uint256", "name": "amountIn", "type": "uint256"},
            {"internalType": "uint256", "name": "reserveIn", "type": "uint256"},
            {"internalType": "uint256", "name": "reserveOut", "type": "uint256"},
        ],
        "name": "getAmountOut",
        "outputs": [{"internalType": "uint256", "name": "amountOut", "type": "uint256"}],
        "stateMutability": "pure",
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
            {"internalType": "uint256", "name": "amountOutMin", "type": "uint256"},
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
            {"internalType": "uint256", "name": "amountOutMin", "type": "uint256"},
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

        self.exchange = self.w3.eth.contract(address=self.exchange_address, abi=EXCHANGE_ABI)
        self.cash_token = self.w3.eth.contract(address=self.cash_address, abi=ERC20_ABI)

        self.product_addresses = [
            Web3.to_checksum_address(os.getenv(f"PROD{i}_ADDRESS")) for i in range(1, 6)
        ]

        self.product_tokens: Dict[str, Any] = {
            addr: self.w3.eth.contract(address=addr, abi=ERC20_ABI)
            for addr in self.product_addresses
        }
        self._decimals_cache: Dict[str, int] = {}

    # ── Internal ──────────────────────────────────────────────────────────────

    def _get_decimals(self, token_contract) -> int:
        addr = token_contract.address
        if addr not in self._decimals_cache:
            self._decimals_cache[addr] = token_contract.functions.decimals().call()
        return self._decimals_cache[addr]

    def _build_and_send(self, tx_function):
        """Build, sign and send a transaction. Returns receipt."""
        nonce = self.w3.eth.get_transaction_count(self.address)
        gas_price = self.w3.eth.gas_price
        tx = tx_function.build_transaction({
            "from": self.address,
            "nonce": nonce,
            "gas": 500_000,
            "gasPrice": gas_price,
        })
        signed = self.w3.eth.account.sign_transaction(tx, private_key=self.private_key)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        return self.w3.eth.wait_for_transaction_receipt(tx_hash)

    def _build_and_send_with_retry(self, tx_function):
        """Retry transaction up to _RETRY_MAX times on failure."""
        for attempt in range(1, _RETRY_MAX + 1):
            try:
                return self._build_and_send(tx_function)
            except Exception as e:
                if attempt == _RETRY_MAX:
                    raise
                print(f"[{self.address}] tx attempt {attempt} failed: {e}. Retrying...")
                time.sleep(_RETRY_DELAY)

    def _calc_amount_out_min(self, amount_in_wei: int, reserve_in_wei: int, reserve_out_wei: int) -> int:
        """Calculate minimum acceptable output with slippage protection."""
        expected = self.exchange.functions.getAmountOut(
            amount_in_wei, reserve_in_wei, reserve_out_wei
        ).call()
        return int(expected * (1 - _SLIPPAGE_PCT / 100))

    # ── Public ────────────────────────────────────────────────────────────────

    def get_competition_status(self) -> Dict[str, int]:
        status, start_time, end_time = self.exchange.functions.getCompetitionStatus().call()
        return {"status": int(status), "start_time": int(start_time), "end_time": int(end_time)}

    def wait_until_active(self, interval_seconds: int = 2):
        while True:
            data = self.get_competition_status()
            if data["status"] == 1:
                return
            if data["status"] == 2:
                raise RuntimeError("A competicao ja terminou antes de comecar")
            print(f"[{self.address}] aguardando inicio da competicao...")
            time.sleep(interval_seconds)

    def get_cash_balance(self) -> float:
        raw = self.cash_token.functions.balanceOf(self.address).call()
        return raw / (10 ** self._get_decimals(self.cash_token))

    def get_product_balance(self, product_address: str) -> float:
        token = self.product_tokens[product_address]
        raw = token.functions.balanceOf(self.address).call()
        return raw / (10 ** self._get_decimals(token))

    def get_all_product_balances(self) -> Dict[str, float]:
        return {addr: self.get_product_balance(addr) for addr in self.product_addresses}

    def get_product_symbol(self, product_address: str) -> str:
        return self.product_tokens[product_address].functions.symbol().call()

    def get_pool(self, product_address: str) -> Dict[str, float]:
        exists, _, reserve_base, reserve_product = self.exchange.functions.getPool(product_address).call()
        if not exists:
            return {
                "exists": False,
                "reserve_base": 0.0, "reserve_product": 0.0,
                "reserve_base_wei": 0, "reserve_product_wei": 0,
                "spot_price": 0.0,
            }
        price_raw = self.exchange.functions.getSpotPrice(product_address).call()
        token = self.product_tokens[product_address]
        decimals = self._get_decimals(token)
        return {
            "exists": True,
            "reserve_base": reserve_base / 1e18,
            "reserve_product": reserve_product / (10 ** decimals),
            "reserve_base_wei": reserve_base,
            "reserve_product_wei": reserve_product,
            "spot_price": price_raw / 1e18,
        }

    def get_all_pools(self) -> List[Dict[str, Any]]:
        pools = []
        for addr in self.product_addresses:
            pool = self.get_pool(addr)
            if not pool["exists"]:
                continue  # skip pools not yet created
            pool["address"] = addr
            pool["symbol"] = self.get_product_symbol(addr)
            pools.append(pool)
        return pools

    def ensure_approval(self, token_contract, spender: str, amount_wei: int):
        current = token_contract.functions.allowance(self.address, spender).call()
        if current >= amount_wei:
            return
        receipt = self._build_and_send_with_retry(
            token_contract.functions.approve(spender, amount_wei)
        )
        print(f"[{self.address}] approve: {receipt.transactionHash.hex()}")

    def buy(self, product_address: str, amount_in_base: float):
        amount_wei = self.w3.to_wei(amount_in_base, "ether")
        self.ensure_approval(self.cash_token, self.exchange_address, amount_wei)

        # Slippage protection: get pool reserves and calculate min output
        pool = self.get_pool(product_address)
        if not pool["exists"] or pool["reserve_base_wei"] == 0:
            raise ValueError(f"Pool does not exist or has zero reserves for {product_address}")
        amount_out_min = self._calc_amount_out_min(
            amount_wei,
            pool["reserve_base_wei"],
            pool["reserve_product_wei"],
        )

        receipt = self._build_and_send_with_retry(
            self.exchange.functions.buy(product_address, amount_wei, amount_out_min)
        )
        print(
            f"[{self.address}] BUY {self.get_product_symbol(product_address)} | "
            f"base_in={amount_in_base:.4f} | min_out={amount_out_min} | "
            f"tx={receipt.transactionHash.hex()}"
        )
        return receipt

    def sell(self, product_address: str, amount_in_product: float):
        token = self.product_tokens[product_address]
        decimals = self._get_decimals(token)
        amount_wei = int(amount_in_product * (10 ** decimals))
        self.ensure_approval(token, self.exchange_address, amount_wei)

        # Slippage protection: swap reserves for sell direction
        pool = self.get_pool(product_address)
        if not pool["exists"] or pool["reserve_product_wei"] == 0:
            raise ValueError(f"Pool does not exist or has zero reserves for {product_address}")
        amount_out_min = self._calc_amount_out_min(
            amount_wei,
            pool["reserve_product_wei"],
            pool["reserve_base_wei"],
        )

        receipt = self._build_and_send_with_retry(
            self.exchange.functions.sell(product_address, amount_wei, amount_out_min)
        )
        print(
            f"[{self.address}] SELL {self.get_product_symbol(product_address)} | "
            f"product_in={amount_in_product:.4f} | min_out={amount_out_min} | "
            f"tx={receipt.transactionHash.hex()}"
        )
        return receipt
