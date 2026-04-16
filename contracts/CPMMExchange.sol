// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CPMMExchange is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 30; // 0.3%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    IERC20 public immutable baseToken;

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

    constructor(address _baseToken, address initialOwner) Ownable(initialOwner) {
        require(_baseToken != address(0), "Invalid base token address");
        baseToken = IERC20(_baseToken);
        competitionStatus = CompetitionStatus.NOT_STARTED;
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
        IERC20(productToken).safeTransferFrom(
            msg.sender,
            address(this),
            initialProductAmount
        );

        pools[productToken] = Pool({
            exists: true,
            productToken: IERC20(productToken),
            reserveBase: initialBaseAmount,
            reserveProduct: initialProductAmount
        });

        productTokens.push(productToken);

        emit PoolCreated(
            productToken,
            initialBaseAmount,
            initialProductAmount
        );
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
            competitionStatus == CompetitionStatus.NOT_STARTED,
            "Competition already started or ended"
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
        require(
            competitionStatus == CompetitionStatus.ACTIVE,
            "Competition is not active"
        );

        competitionStatus = CompetitionStatus.ENDED;
        competitionEndTime = block.timestamp;

        emit CompetitionEnded(block.timestamp);
    }

    function buy(
        address productToken,
        uint256 baseAmountIn
    )
        external
        onlyRegisteredTrader
        onlyWhenActive
        returns (uint256 productAmountOut)
    {
        require(baseAmountIn > 0, "Input amount must be > 0");

        Pool storage pool = pools[productToken];
        require(pool.exists, "Pool does not exist");

        productAmountOut = getAmountOut(
            baseAmountIn,
            pool.reserveBase,
            pool.reserveProduct
        );

        require(productAmountOut > 0, "Output amount is zero");
        require(
            productAmountOut < pool.reserveProduct,
            "Insufficient product liquidity"
        );

        baseToken.safeTransferFrom(msg.sender, address(this), baseAmountIn);
        pool.productToken.safeTransfer(msg.sender, productAmountOut);

        pool.reserveBase += baseAmountIn;
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
        uint256 productAmountIn
    )
        external
        onlyRegisteredTrader
        onlyWhenActive
        returns (uint256 baseAmountOut)
    {
        require(productAmountIn > 0, "Input amount must be > 0");

        Pool storage pool = pools[productToken];
        require(pool.exists, "Pool does not exist");

        baseAmountOut = getAmountOut(
            productAmountIn,
            pool.reserveProduct,
            pool.reserveBase
        );

        require(baseAmountOut > 0, "Output amount is zero");
        require(
            baseAmountOut < pool.reserveBase,
            "Insufficient base liquidity"
        );

        pool.productToken.safeTransferFrom(
            msg.sender,
            address(this),
            productAmountIn
        );
        baseToken.safeTransfer(msg.sender, baseAmountOut);

        pool.reserveProduct += productAmountIn;
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

    function isCompetitionActive() public view returns (bool) {
        if (competitionStatus != CompetitionStatus.ACTIVE) {
            return false;
        }

        if (competitionEndTime == 0) {
            return false;
        }

        return block.timestamp < competitionEndTime;
    }

    function getCurrentCompetitionStatus()
        public
        view
        returns (CompetitionStatus)
    {
        if (competitionStatus == CompetitionStatus.ACTIVE && block.timestamp >= competitionEndTime) {
            return CompetitionStatus.ENDED;
        }

        return competitionStatus;
    }

    function getRemainingTime() external view returns (uint256) {
        if (!isCompetitionActive()) {
            return 0;
        }

        return competitionEndTime - block.timestamp;
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256 amountOut) {
        require(amountIn > 0, "Invalid input amount");
        require(reserveIn > 0, "Invalid reserveIn");
        require(reserveOut > 0, "Invalid reserveOut");

        uint256 amountInWithFee = amountIn * (BPS_DENOMINATOR - FEE_BPS);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * BPS_DENOMINATOR) + amountInWithFee;

        amountOut = numerator / denominator;
    }

    function getSpotPrice(address productToken)
        external
        view
        returns (uint256 priceInBase)
    {
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