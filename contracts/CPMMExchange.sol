    // SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CPMMExchange is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    // Fee base: 0.3%
    uint256 public constant BASE_FEE_BPS = 30;

    // Fee maxima por overtrading: 1.5%
    uint256 public constant MAX_FEE_BPS = 150;

    // Cooldown minimo entre trades da mesma wallet
    uint256 public constant TRADE_COOLDOWN = 2 seconds;

    // Janela para contar excesso de trades
    uint256 public constant TRADE_WINDOW = 30 seconds;

    // Impacto maximo por trade: 10% da reserva de saida
    uint256 public constant MAX_PRICE_IMPACT_BPS = 1000;

    IERC20 public immutable baseToken;

    // Para onde vao as fees. Isto cria drenagem real da competicao.
    address public feeTreasury;

    enum CompetitionStatus {
        NOT_STARTED,
        ACTIVE,
        ENDED
    }

    CompetitionStatus public competitionStatus;

    uint256 public competitionStartTime;
    uint256 public competitionEndTime;

    struct Pool {
        bool exists;
        IERC20 productToken;
        uint256 reserveBase;
        uint256 reserveProduct;
    }

    mapping(address => Pool) private pools;
    address[] private productTokens;

    mapping(address => bool) public isTrader;
    uint256 public traderCount;

    mapping(address => uint256) public lastTradeAt;
    mapping(address => uint256) public tradeWindowStart;
    mapping(address => uint256) public tradesInWindow;

    event TraderRegistered(address indexed trader);
    event TraderRemoved(address indexed trader);

    event PoolCreated(
        address indexed productToken,
        uint256 initialBaseAmount,
        uint256 initialProductAmount
    );

    event LiquidityAdded(
        address indexed productToken,
        uint256 baseAmount,
        uint256 productAmount,
        uint256 newReserveBase,
        uint256 newReserveProduct
    );

    event CompetitionStarted(
        uint256 indexed startTime,
        uint256 indexed endTime,
        uint256 durationSeconds
    );

    event CompetitionEnded(uint256 indexed endTime);

    event TradePenalty(
        address indexed trader,
        uint256 feeBps,
        uint256 tradesInWindow,
        uint256 timestamp
    );

    event FeeTreasuryUpdated(
        address indexed oldTreasury,
        address indexed newTreasury
    );

    event FeeCollected(
        address indexed trader,
        address indexed token,
        uint256 grossAmountIn,
        uint256 feeAmount,
        uint256 netAmountIn,
        uint256 feeBps
    );

    event Bought(
        address indexed trader,
        address indexed productToken,
        uint256 baseAmountIn,
        uint256 productAmountOut,
        uint256 newReserveBase,
        uint256 newReserveProduct
    );

    event Sold(
        address indexed trader,
        address indexed productToken,
        uint256 productAmountIn,
        uint256 baseAmountOut,
        uint256 newReserveBase,
        uint256 newReserveProduct
    );

    modifier onlyRegisteredTrader() {
        require(isTrader[msg.sender], "Trader not registered");
        _;
    }

    modifier onlyWhenActive() {
        require(isCompetitionActive(), "Competition is not active");
        _;
    }

    constructor(
        address _baseToken,
        address initialOwner,
        address _feeTreasury
    ) Ownable(initialOwner) {
        require(_baseToken != address(0), "Invalid base token address");
        require(initialOwner != address(0), "Invalid owner address");
        require(_feeTreasury != address(0), "Invalid fee treasury address");

        baseToken = IERC20(_baseToken);
        feeTreasury = _feeTreasury;
        competitionStatus = CompetitionStatus.NOT_STARTED;
    }

    function setFeeTreasury(address newFeeTreasury) external onlyOwner {
        require(newFeeTreasury != address(0), "Invalid fee treasury address");

        address oldTreasury = feeTreasury;
        feeTreasury = newFeeTreasury;

        emit FeeTreasuryUpdated(oldTreasury, newFeeTreasury);
    }

    function registerTrader(address trader) external onlyOwner {
        require(trader != address(0), "Invalid trader address");
        require(!isTrader[trader], "Trader already registered");

        isTrader[trader] = true;
        traderCount += 1;

        emit TraderRegistered(trader);
    }

    function registerTraders(address[] calldata traders) external onlyOwner {
        uint256 length = traders.length;
        require(length > 0, "Empty trader list");

        for (uint256 i = 0; i < length; i++) {
            address trader = traders[i];
            require(trader != address(0), "Invalid trader address");

            if (!isTrader[trader]) {
                isTrader[trader] = true;
                traderCount += 1;
                emit TraderRegistered(trader);
            }
        }
    }

    function removeTrader(address trader) external onlyOwner {
        require(isTrader[trader], "Trader not registered");

        isTrader[trader] = false;
        traderCount -= 1;

        emit TraderRemoved(trader);
    }

    function createPool(
        address productToken,
        uint256 initialBaseAmount,
        uint256 initialProductAmount
    ) external onlyOwner {
        require(productToken != address(0), "Invalid product token");
        require(!pools[productToken].exists, "Pool already exists");
        require(productToken != address(baseToken), "Product cannot be base token");
        require(initialBaseAmount > 0, "Initial base amount must be > 0");
        require(initialProductAmount > 0, "Initial product amount must be > 0");

        baseToken.safeTransferFrom(msg.sender, address(this), initialBaseAmount);
        IERC20(productToken).safeTransferFrom(msg.sender, address(this), initialProductAmount);

        pools[productToken] = Pool({
            exists: true,
            productToken: IERC20(productToken),
            reserveBase: initialBaseAmount,
            reserveProduct: initialProductAmount
        });

        productTokens.push(productToken);

        emit PoolCreated(productToken, initialBaseAmount, initialProductAmount);
    }

    function addLiquidity(
        address productToken,
        uint256 baseAmount,
        uint256 productAmount
    ) external onlyOwner {
        Pool storage pool = pools[productToken];

        require(pool.exists, "Pool does not exist");
        require(baseAmount > 0, "Base amount must be > 0");
        require(productAmount > 0, "Product amount must be > 0");
        require(pool.reserveBase > 0 && pool.reserveProduct > 0, "Pool reserves are zero");

        baseToken.safeTransferFrom(msg.sender, address(this), baseAmount);
        pool.productToken.safeTransferFrom(msg.sender, address(this), productAmount);

        pool.reserveBase += baseAmount;
        pool.reserveProduct += productAmount;

        emit LiquidityAdded(
            productToken,
            baseAmount,
            productAmount,
            pool.reserveBase,
            pool.reserveProduct
        );
    }

    function startCompetition(uint256 durationSeconds) external onlyOwner {
        require(
            competitionStatus == CompetitionStatus.NOT_STARTED ||
            competitionStatus == CompetitionStatus.ENDED,
            "Competition is already running"
        );
        require(durationSeconds > 0, "Duration must be > 0");

        competitionStatus = CompetitionStatus.ACTIVE;
        competitionStartTime = block.timestamp;
        competitionEndTime = block.timestamp + durationSeconds;

        emit CompetitionStarted(
            competitionStartTime,
            competitionEndTime,
            durationSeconds
        );
    }

    function endCompetition() external onlyOwner {
        require(competitionStatus == CompetitionStatus.ACTIVE, "Competition is not active");

        competitionStatus = CompetitionStatus.ENDED;

        emit CompetitionEnded(block.timestamp);
    }

    function buy(
        address productToken,
        uint256 baseAmountIn,
        uint256 amountOutMin
    )
        external
        onlyRegisteredTrader
        onlyWhenActive
        returns (uint256 productAmountOut)
    {
        require(baseAmountIn > 0, "Input amount must be > 0");

        Pool storage pool = pools[productToken];
        require(pool.exists, "Pool does not exist");

        uint256 feeBps = _updateTraderActivity(msg.sender);
        (uint256 netBaseAmountIn, uint256 feeAmount) = _splitFee(baseAmountIn, feeBps);

        productAmountOut = _getAmountOutNoFee(
            netBaseAmountIn,
            pool.reserveBase,
            pool.reserveProduct
        );

        require(productAmountOut > 0, "Output amount is zero");
        require(productAmountOut < pool.reserveProduct, "Insufficient product liquidity");

        _validatePriceImpact(productAmountOut, pool.reserveProduct);

        require(productAmountOut >= amountOutMin, "Slippage: insufficient output amount");

        baseToken.safeTransferFrom(msg.sender, address(this), baseAmountIn);

        if (feeAmount > 0) {
            baseToken.safeTransfer(feeTreasury, feeAmount);

            emit FeeCollected(
                msg.sender,
                address(baseToken),
                baseAmountIn,
                feeAmount,
                netBaseAmountIn,
                feeBps
            );
        }

        pool.productToken.safeTransfer(msg.sender, productAmountOut);

        pool.reserveBase += netBaseAmountIn;
        pool.reserveProduct -= productAmountOut;

        emit Bought(
            msg.sender,
            productToken,
            baseAmountIn,
            productAmountOut,
            pool.reserveBase,
            pool.reserveProduct
        );
    }

    function sell(
        address productToken,
        uint256 productAmountIn,
        uint256 amountOutMin
    )
        external
        onlyRegisteredTrader
        onlyWhenActive
        returns (uint256 baseAmountOut)
    {
        require(productAmountIn > 0, "Input amount must be > 0");

        Pool storage pool = pools[productToken];
        require(pool.exists, "Pool does not exist");

        uint256 feeBps = _updateTraderActivity(msg.sender);
        (uint256 netProductAmountIn, uint256 feeAmount) = _splitFee(productAmountIn, feeBps);

        baseAmountOut = _getAmountOutNoFee(
            netProductAmountIn,
            pool.reserveProduct,
            pool.reserveBase
        );

        require(baseAmountOut > 0, "Output amount is zero");
        require(baseAmountOut < pool.reserveBase, "Insufficient base liquidity");

        _validatePriceImpact(baseAmountOut, pool.reserveBase);

        require(baseAmountOut >= amountOutMin, "Slippage: insufficient output amount");

        pool.productToken.safeTransferFrom(msg.sender, address(this), productAmountIn);

        if (feeAmount > 0) {
            pool.productToken.safeTransfer(feeTreasury, feeAmount);

            emit FeeCollected(
                msg.sender,
                productToken,
                productAmountIn,
                feeAmount,
                netProductAmountIn,
                feeBps
            );
        }

        baseToken.safeTransfer(msg.sender, baseAmountOut);

        pool.reserveProduct += netProductAmountIn;
        pool.reserveBase -= baseAmountOut;

        emit Sold(
            msg.sender,
            productToken,
            productAmountIn,
            baseAmountOut,
            pool.reserveBase,
            pool.reserveProduct
        );
    }

    function _updateTraderActivity(address trader) internal returns (uint256 feeBps) {
        require(
            block.timestamp >= lastTradeAt[trader] + TRADE_COOLDOWN,
            "Cooldown: trading too fast"
        );

        if (block.timestamp > tradeWindowStart[trader] + TRADE_WINDOW) {
            tradeWindowStart[trader] = block.timestamp;
            tradesInWindow[trader] = 0;
        }

        tradesInWindow[trader] += 1;
        lastTradeAt[trader] = block.timestamp;

        feeBps = BASE_FEE_BPS;

        if (tradesInWindow[trader] > 3) {
            feeBps += (tradesInWindow[trader] - 3) * 20;
        }

        if (feeBps > MAX_FEE_BPS) {
            feeBps = MAX_FEE_BPS;
        }

        emit TradePenalty(
            trader,
            feeBps,
            tradesInWindow[trader],
            block.timestamp
        );
    }

    function _splitFee(
        uint256 amountIn,
        uint256 feeBps
    )
        internal
        pure
        returns (uint256 netAmountIn, uint256 feeAmount)
    {
        require(amountIn > 0, "Invalid input amount");
        require(feeBps < BPS_DENOMINATOR, "Invalid fee");

        feeAmount = (amountIn * feeBps) / BPS_DENOMINATOR;
        netAmountIn = amountIn - feeAmount;
    }

    function _getAmountOutNoFee(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    )
        internal
        pure
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "Invalid input amount");
        require(reserveIn > 0, "Invalid reserveIn");
        require(reserveOut > 0, "Invalid reserveOut");

        uint256 numerator = amountIn * reserveOut;
        uint256 denominator = reserveIn + amountIn;

        amountOut = numerator / denominator;
    }

    function _validatePriceImpact(
        uint256 amountOut,
        uint256 reserveOut
    ) internal pure {
        uint256 impactBps = (amountOut * BPS_DENOMINATOR) / reserveOut;
        require(impactBps <= MAX_PRICE_IMPACT_BPS, "Price impact too high");
    }

    function isCompetitionActive() public view returns (bool) {
        if (competitionStatus != CompetitionStatus.ACTIVE) return false;
        if (competitionEndTime == 0) return false;

        return block.timestamp < competitionEndTime;
    }

    function getCurrentCompetitionStatus() public view returns (CompetitionStatus) {
        if (
            competitionStatus == CompetitionStatus.ACTIVE &&
            block.timestamp >= competitionEndTime
        ) {
            return CompetitionStatus.ENDED;
        }

        return competitionStatus;
    }

    function getRemainingTime() external view returns (uint256) {
        if (!isCompetitionActive()) return 0;

        return competitionEndTime - block.timestamp;
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256 amountOut) {
        uint256 netAmountIn = amountIn - ((amountIn * BASE_FEE_BPS) / BPS_DENOMINATOR);

        return _getAmountOutNoFee(netAmountIn, reserveIn, reserveOut);
    }

    function getAmountOutWithFeeBps(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeBps
    ) external pure returns (uint256 amountOut) {
        (uint256 netAmountIn, ) = _splitFee(amountIn, feeBps);

        return _getAmountOutNoFee(netAmountIn, reserveIn, reserveOut);
    }

    function getCurrentFeeBps(address trader) external view returns (uint256 feeBps) {
        feeBps = BASE_FEE_BPS;

        uint256 currentTradesInWindow = tradesInWindow[trader];

        if (block.timestamp > tradeWindowStart[trader] + TRADE_WINDOW) {
            currentTradesInWindow = 0;
        }

        uint256 nextTradeCount = currentTradesInWindow + 1;

        if (nextTradeCount > 3) {
            feeBps += (nextTradeCount - 3) * 20;
        }

        if (feeBps > MAX_FEE_BPS) {
            feeBps = MAX_FEE_BPS;
        }
    }

    function getSpotPrice(address productToken) external view returns (uint256 priceInBase) {
        Pool storage pool = pools[productToken];

        require(pool.exists, "Pool does not exist");
        require(pool.reserveProduct > 0, "Invalid product reserve");

        priceInBase = (pool.reserveBase * 1e18) / pool.reserveProduct;
    }

    function getPool(address productToken)
        external
        view
        returns (
            bool exists,
            address token,
            uint256 reserveBase,
            uint256 reserveProduct
        )
    {
        Pool storage pool = pools[productToken];

        return (
            pool.exists,
            address(pool.productToken),
            pool.reserveBase,
            pool.reserveProduct
        );
    }

    function getProductTokens() external view returns (address[] memory) {
        return productTokens;
    }

    function getPoolCount() external view returns (uint256) {
        return productTokens.length;
    }

    function poolExists(address productToken) external view returns (bool) {
        return pools[productToken].exists;
    }

    function getCompetitionStatus()
        external
        view
        returns (
            CompetitionStatus status,
            uint256 startTime,
            uint256 endTime
        )
    {
        return (
            getCurrentCompetitionStatus(),
            competitionStartTime,
            competitionEndTime
        );
    }
}