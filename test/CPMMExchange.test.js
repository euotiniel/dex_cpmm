import { expect } from "chai";
import hre from "hardhat";

const { ethers } = hre;

// ── Helpers ───────────────────────────────────────────────────────────────
const parse = (n) => ethers.parseUnits(String(n), 18);
const format = (n) => Number(ethers.formatUnits(n, 18));

// Mirrors the contract's getAmountOut
function cpmmAmountOut(amountIn, reserveIn, reserveOut) {
  const FEE_BPS = 30n;
  const BPS = 10_000n;
  const amtFee = amountIn * (BPS - FEE_BPS);
  return (amtFee * reserveOut) / (reserveIn * BPS + amtFee);
}

// ── Fixtures ──────────────────────────────────────────────────────────────
async function deployFixture() {
  const [owner, trader1, trader2, stranger] = await ethers.getSigners();

  const Token    = await ethers.getContractFactory("MarketToken");
  const Exchange = await ethers.getContractFactory("CPMMExchange");

  const cash    = await Token.deploy("Cash", "CASH", owner.address);
  const prod1   = await Token.deploy("Product1", "PROD1", owner.address);
  const exchange = await Exchange.deploy(await cash.getAddress(), owner.address);

  return { cash, prod1, exchange, owner, trader1, trader2, stranger };
}

async function setupPool(cash, prod1, exchange, owner) {
  const BASE = parse(10_000);
  const PROD = parse(1_000);

  await cash.mint(owner.address, parse(1_000_000));
  await prod1.mint(owner.address, parse(100_000));

  await cash.approve(await exchange.getAddress(), parse(1_000_000));
  await prod1.approve(await exchange.getAddress(), parse(100_000));

  await exchange.createPool(await prod1.getAddress(), BASE, PROD);
  return { BASE, PROD };
}

async function fundTrader(cash, trader, exchange, amount = 1_000) {
  const addr = await exchange.getAddress();
  await cash.mint(trader.address, parse(amount));
  await cash.connect(trader).approve(addr, parse(amount));
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("CPMMExchange", () => {

  // ── Deployment ────────────────────────────────────────────────────────
  describe("Deployment", () => {
    it("sets baseToken correctly", async () => {
      const { cash, exchange } = await deployFixture();
      expect(await exchange.baseToken()).to.equal(await cash.getAddress());
    });

    it("starts with NOT_STARTED status", async () => {
      const { exchange } = await deployFixture();
      const [status] = await exchange.getCompetitionStatus();
      expect(Number(status)).to.equal(0); // NOT_STARTED
    });

    it("reverts with invalid base token", async () => {
      const Exchange = await ethers.getContractFactory("CPMMExchange");
      const [owner] = await ethers.getSigners();
      await expect(
        Exchange.deploy(ethers.ZeroAddress, owner.address)
      ).to.be.revertedWith("Invalid base token address");
    });
  });

  // ── Pool creation ─────────────────────────────────────────────────────
  describe("createPool", () => {
    it("creates pool with correct reserves", async () => {
      const { cash, prod1, exchange, owner } = await deployFixture();
      const { BASE, PROD } = await setupPool(cash, prod1, exchange, owner);

      const [exists, , rBase, rProd] = await exchange.getPool(await prod1.getAddress());
      expect(exists).to.be.true;
      expect(rBase).to.equal(BASE);
      expect(rProd).to.equal(PROD);
    });

    it("reverts when pool already exists", async () => {
      const { cash, prod1, exchange, owner } = await deployFixture();
      await setupPool(cash, prod1, exchange, owner);

      await expect(
        exchange.createPool(await prod1.getAddress(), parse(1), parse(1))
      ).to.be.revertedWith("Pool already exists");
    });

    it("reverts with zero amounts", async () => {
      const { prod1, exchange } = await deployFixture();
      await expect(
        exchange.createPool(await prod1.getAddress(), 0, parse(1))
      ).to.be.revertedWith("Initial base amount must be > 0");
    });

    it("only owner can create pools", async () => {
      const { prod1, exchange, trader1 } = await deployFixture();
      await expect(
        exchange.connect(trader1).createPool(await prod1.getAddress(), parse(1), parse(1))
      ).to.be.reverted;
    });
  });

  // ── CPMM Formula ──────────────────────────────────────────────────────
  describe("getAmountOut (CPMM x*y=k)", () => {
    it("matches JS reference implementation", async () => {
      const { exchange } = await deployFixture();
      const amtIn   = parse(100);
      const rIn     = parse(10_000);
      const rOut    = parse(1_000);

      const onChain = await exchange.getAmountOut(amtIn, rIn, rOut);
      const offChain = cpmmAmountOut(amtIn, rIn, rOut);

      expect(onChain).to.equal(offChain);
    });

    it("applies 0.3% fee (output < no-fee output)", async () => {
      const { exchange } = await deployFixture();
      const amtIn = parse(100);
      const rIn   = parse(10_000);
      const rOut  = parse(1_000);

      const withFee   = await exchange.getAmountOut(amtIn, rIn, rOut);
      // No-fee would be: 100 * 1000 / (10000 + 100) ≈ 9.9009…
      const noFee = (amtIn * rOut) / (rIn + amtIn);
      expect(withFee).to.be.lessThan(noFee);
    });

    it("reverts with zero inputs", async () => {
      const { exchange } = await deployFixture();
      await expect(
        exchange.getAmountOut(0, parse(100), parse(100))
      ).to.be.revertedWith("Invalid input amount");
    });
  });

  // ── Trading ───────────────────────────────────────────────────────────
  describe("buy / sell", () => {
    async function activeTradeFixture() {
      const f = await deployFixture();
      const { cash, prod1, exchange, owner, trader1 } = f;
      await setupPool(cash, prod1, exchange, owner);

      await exchange.registerTrader(trader1.address);
      await fundTrader(cash, trader1, exchange);

      await exchange.startCompetition(600); // 10 min

      return { ...f, prod1Addr: await prod1.getAddress(), exchAddr: await exchange.getAddress() };
    }

    it("buy transfers tokens correctly", async () => {
      const { cash, prod1, exchange, trader1, prod1Addr, exchAddr } = await activeTradeFixture();

      const buyAmt = parse(100);
      await exchange.connect(trader1).buy(prod1Addr, buyAmt, 0);

      const prod1Balance = await prod1.balanceOf(trader1.address);
      expect(prod1Balance).to.be.greaterThan(0n);
    });

    it("buy updates reserves correctly (x*y = k invariant)", async () => {
      const { exchange, trader1, prod1Addr } = await activeTradeFixture();

      const [, , rBaseBefore, rProdBefore] = await exchange.getPool(prod1Addr);
      const kBefore = rBaseBefore * rProdBefore;

      await exchange.connect(trader1).buy(prod1Addr, parse(100), 0);

      const [, , rBaseAfter, rProdAfter] = await exchange.getPool(prod1Addr);
      const kAfter = rBaseAfter * rProdAfter;

      // k must be at least as large as before (fee means k increases)
      expect(kAfter).to.be.greaterThanOrEqual(kBefore);
    });

    it("sell transfers base token back correctly", async () => {
      const { cash, prod1, exchange, trader1, prod1Addr, exchAddr } = await activeTradeFixture();

      // First buy some product
      await exchange.connect(trader1).buy(prod1Addr, parse(100), 0);
      const prodBal = await prod1.balanceOf(trader1.address);

      // Approve and sell half
      await prod1.connect(trader1).approve(exchAddr, prodBal);
      const cashBefore = await cash.balanceOf(trader1.address);
      await exchange.connect(trader1).sell(prod1Addr, prodBal / 2n, 0);
      const cashAfter  = await cash.balanceOf(trader1.address);

      expect(cashAfter).to.be.greaterThan(cashBefore);
    });

    it("buy reverts with slippage protection", async () => {
      const { exchange, trader1, prod1Addr } = await activeTradeFixture();

      // Expect ~9 tokens for 100 CASH; set min to 100 (impossible)
      await expect(
        exchange.connect(trader1).buy(prod1Addr, parse(100), parse(100))
      ).to.be.revertedWith("Slippage: insufficient output amount");
    });

    it("sell reverts with slippage protection", async () => {
      const { prod1, exchange, trader1, prod1Addr, exchAddr } = await activeTradeFixture();

      await exchange.connect(trader1).buy(prod1Addr, parse(100), 0);
      const prodBal = await prod1.balanceOf(trader1.address);
      await prod1.connect(trader1).approve(exchAddr, prodBal);

      // Selling 1 unit should give ~10 CASH; require 1000 (impossible)
      await expect(
        exchange.connect(trader1).sell(prod1Addr, parse(1), parse(1000))
      ).to.be.revertedWith("Slippage: insufficient output amount");
    });

    it("unregistered trader cannot trade", async () => {
      const { exchange, stranger, prod1Addr } = await activeTradeFixture();
      await expect(
        exchange.connect(stranger).buy(prod1Addr, parse(10), 0)
      ).to.be.revertedWith("Trader not registered");
    });

    it("trading not allowed before competition starts", async () => {
      const f = await deployFixture();
      const { cash, prod1, exchange, owner, trader1 } = f;
      await setupPool(cash, prod1, exchange, owner);
      await exchange.registerTrader(trader1.address);
      await fundTrader(cash, trader1, exchange);
      // Competition NOT started
      await expect(
        exchange.connect(trader1).buy(await prod1.getAddress(), parse(10), 0)
      ).to.be.revertedWith("Competition is not active");
    });
  });

  // ── Competition Lifecycle ─────────────────────────────────────────────
  describe("Competition lifecycle", () => {
    it("starts competition correctly", async () => {
      const { exchange } = await deployFixture();
      await exchange.startCompetition(300);

      const [status, startTime, endTime] = await exchange.getCompetitionStatus();
      expect(Number(status)).to.equal(1); // ACTIVE
      expect(Number(endTime)).to.be.greaterThan(Number(startTime));
    });

    it("cannot start competition twice", async () => {
      const { exchange } = await deployFixture();
      await exchange.startCompetition(300);
      await expect(exchange.startCompetition(300)).to.be.revertedWith(
        "Competition already started or ended"
      );
    });

    it("endCompetition reverts before timer expires", async () => {
      const { exchange } = await deployFixture();
      await exchange.startCompetition(3600); // 1 hour, won't expire

      await expect(exchange.endCompetition()).to.be.revertedWith(
        "Competition timer has not expired yet"
      );
    });

    it("endCompetition succeeds after timer expires (via time travel)", async () => {
      const { exchange } = await deployFixture();
      await exchange.startCompetition(60); // 60 seconds

      // Advance blockchain time by 61 seconds
      await hre.network.provider.send("evm_increaseTime", [61]);
      await hre.network.provider.send("evm_mine");

      await exchange.endCompetition();

      const [status] = await exchange.getCompetitionStatus();
      expect(Number(status)).to.equal(2); // ENDED
    });

    it("trading stops after competition ends", async () => {
      const f = await deployFixture();
      const { cash, prod1, exchange, owner, trader1 } = f;
      await setupPool(cash, prod1, exchange, owner);
      await exchange.registerTrader(trader1.address);
      await fundTrader(cash, trader1, exchange);
      await exchange.startCompetition(1); // 1 second

      await hre.network.provider.send("evm_increaseTime", [2]);
      await hre.network.provider.send("evm_mine");

      await expect(
        exchange.connect(trader1).buy(await prod1.getAddress(), parse(10), 0)
      ).to.be.revertedWith("Competition is not active");
    });

    it("getRemainingTime returns 0 when competition not active", async () => {
      const { exchange } = await deployFixture();
      expect(await exchange.getRemainingTime()).to.equal(0n);
    });
  });

  // ── Spot Price ────────────────────────────────────────────────────────
  describe("getSpotPrice", () => {
    it("returns correct initial price (10 CASH per token)", async () => {
      const { cash, prod1, exchange, owner } = await deployFixture();
      await setupPool(cash, prod1, exchange, owner);

      const price = await exchange.getSpotPrice(await prod1.getAddress());
      // 10000 / 1000 = 10, scaled by 1e18
      const expectedPrice = parse(10);
      expect(price).to.equal(expectedPrice);
    });

    it("price increases after buy pressure", async () => {
      const f = await deployFixture();
      const { cash, prod1, exchange, owner, trader1 } = f;
      await setupPool(cash, prod1, exchange, owner);
      await exchange.registerTrader(trader1.address);
      await fundTrader(cash, trader1, exchange);
      await exchange.startCompetition(600);

      const prod1Addr = await prod1.getAddress();
      const priceBefore = await exchange.getSpotPrice(prod1Addr);
      await exchange.connect(trader1).buy(prod1Addr, parse(500), 0);
      const priceAfter = await exchange.getSpotPrice(prod1Addr);

      expect(priceAfter).to.be.greaterThan(priceBefore);
    });
  });

  // ── Trader management ─────────────────────────────────────────────────
  describe("Trader management", () => {
    it("registers and removes a trader", async () => {
      const { exchange, trader1 } = await deployFixture();
      await exchange.registerTrader(trader1.address);
      expect(await exchange.isTrader(trader1.address)).to.be.true;

      await exchange.removeTrader(trader1.address);
      expect(await exchange.isTrader(trader1.address)).to.be.false;
    });

    it("registerTraders registers multiple at once", async () => {
      const { exchange, trader1, trader2 } = await deployFixture();
      await exchange.registerTraders([trader1.address, trader2.address]);
      expect(await exchange.isTrader(trader1.address)).to.be.true;
      expect(await exchange.isTrader(trader2.address)).to.be.true;
    });

    it("traderCount tracks registrations correctly", async () => {
      const { exchange, trader1, trader2 } = await deployFixture();
      expect(await exchange.traderCount()).to.equal(0n);

      await exchange.registerTrader(trader1.address);
      expect(await exchange.traderCount()).to.equal(1n);

      await exchange.registerTrader(trader2.address);
      expect(await exchange.traderCount()).to.equal(2n);

      await exchange.removeTrader(trader1.address);
      expect(await exchange.traderCount()).to.equal(1n);
    });
  });
});
