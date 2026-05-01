// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CPMMExchange is Ownable {
    uint256 public constant BASE_FEE_BPS = 30;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    uint256 public constant COOLDOWN_SECONDS = 2;
    uint256 public constant MAX_PRICE_IMPACT_BPS = 800;

    enum CompetitionStatus {
        NOT_STARTED,
        ACTIVE,
        ENDED
    }

    struct Pool {
        bool exists;
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
    }

    CompetitionStatus public competitionStatus;
    uint256 public competitionStartTime;
    uint256 public competitionEndTime;

    address[] public tokens;
    bytes32[] public poolIds;

    mapping(address => bool) public supportedToken;
    mapping(bytes32 => Pool) public pools;

    mapping(address => bool) public isTrader;
    mapping(address => uint256) public traderTradeCount;
    mapping(address => uint256) public traderLastTradeAt;
    mapping(address => uint256) public traderFeesPaid;

    uint256 public traderCount;
    uint256 public totalFeesPaid;

    event PoolCreated(
        bytes32 indexed poolId,
        address indexed token0,
        address indexed token1,
        uint256 reserve0,
        uint256 reserve1
    );

    event Swapped(
        address indexed trader,
        bytes32 indexed poolId,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 newReserveIn,
        uint256 newReserveOut
    );

    event FeeCharged(
        address indexed trader,
        bytes32 indexed poolId,
        address indexed tokenIn,
        uint256 feeBps,
        uint256 feeAmount
    );

    event CompetitionStarted(
        uint256 indexed startTime,
        uint256 indexed endTime,
        uint256 durationSeconds
    );

    event CompetitionEnded(uint256 indexed endTime);

    modifier onlyActiveCompetition() {
        require(getCurrentCompetitionStatus() == CompetitionStatus.ACTIVE, "Competition not active");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerTokens(address[] calldata tokenList) external onlyOwner {
        require(tokens.length == 0, "Tokens already registered");
        require(tokenList.length == 5, "Exactly 5 tokens required");

        for (uint256 i = 0; i < tokenList.length; i++) {
            require(tokenList[i] != address(0), "Invalid token");
            require(!supportedToken[tokenList[i]], "Token already registered");

            supportedToken[tokenList[i]] = true;
            tokens.push(tokenList[i]);
        }
    }

    function getTokens() external view returns (address[] memory) {
        return tokens;
    }

    function _poolId(address tokenA, address tokenB) internal pure returns (bytes32) {
        require(tokenA != tokenB, "Same token");

        return tokenA < tokenB
            ? keccak256(abi.encodePacked(tokenA, tokenB))
            : keccak256(abi.encodePacked(tokenB, tokenA));
    }

    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32) {
        return _poolId(tokenA, tokenB);
    }

    function createPool(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external onlyOwner {
        require(supportedToken[tokenA] && supportedToken[tokenB], "Unsupported token");
        require(amountA > 0 && amountB > 0, "Invalid liquidity");

        bytes32 id = _poolId(tokenA, tokenB);
        require(!pools[id].exists, "Pool already exists");

        address token0 = tokenA < tokenB ? tokenA : tokenB;
        address token1 = tokenA < tokenB ? tokenB : tokenA;

        uint256 reserve0 = tokenA == token0 ? amountA : amountB;
        uint256 reserve1 = tokenA == token0 ? amountB : amountA;

        IERC20(tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountB);

        pools[id] = Pool({
            exists: true,
            token0: token0,
            token1: token1,
            reserve0: reserve0,
            reserve1: reserve1
        });

        poolIds.push(id);

        emit PoolCreated(id, token0, token1, reserve0, reserve1);
    }

    function getPoolIds() external view returns (bytes32[] memory) {
        return poolIds;
    }

    function getPool(bytes32 poolId)
        external
        view
        returns (
            bool exists,
            address token0,
            address token1,
            uint256 reserve0,
            uint256 reserve1
        )
    {
        Pool memory p = pools[poolId];
        return (p.exists, p.token0, p.token1, p.reserve0, p.reserve1);
    }

    function getPoolByTokens(address tokenA, address tokenB)
        external
        view
        returns (
            bool exists,
            bytes32 poolId,
            address token0,
            address token1,
            uint256 reserve0,
            uint256 reserve1
        )
    {
        bytes32 id = _poolId(tokenA, tokenB);
        Pool memory p = pools[id];

        return (p.exists, id, p.token0, p.token1, p.reserve0, p.reserve1);
    }

    function getTraderFeeBps(address trader) public view returns (uint256) {
        uint256 count = traderTradeCount[trader];

        if (count >= 150) return 150;
        if (count >= 100) return 110;
        if (count >= 60) return 80;
        if (count >= 30) return 50;

        return BASE_FEE_BPS;
    }

    function getPriceImpactBps(
        uint256 amountIn,
        uint256 reserveIn
    ) public pure returns (uint256) {
        require(reserveIn > 0, "Invalid reserve");

        return (amountIn * BPS_DENOMINATOR) / (reserveIn + amountIn);
    }

    function getAmountOutWithFee(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeBps
    ) public pure returns (uint256) {
        require(amountIn > 0, "Invalid amount");
        require(reserveIn > 0 && reserveOut > 0, "Invalid reserves");
        require(feeBps < BPS_DENOMINATOR, "Invalid fee");

        uint256 amountInAfterFee = amountIn * (BPS_DENOMINATOR - feeBps);
        uint256 numerator = amountInAfterFee * reserveOut;
        uint256 denominator = (reserveIn * BPS_DENOMINATOR) + amountInAfterFee;

        return numerator / denominator;
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256) {
        return getAmountOutWithFee(amountIn, reserveIn, reserveOut, BASE_FEE_BPS);
    }

    function quote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        bytes32 id = _poolId(tokenIn, tokenOut);
        Pool memory p = pools[id];

        require(p.exists, "Pool does not exist");

        if (tokenIn == p.token0 && tokenOut == p.token1) {
            return getAmountOut(amountIn, p.reserve0, p.reserve1);
        }

        if (tokenIn == p.token1 && tokenOut == p.token0) {
            return getAmountOut(amountIn, p.reserve1, p.reserve0);
        }

        revert("Invalid pair");
    }

    function quoteForTrader(
        address trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut, uint256 feeBps, uint256 priceImpactBps) {
        bytes32 id = _poolId(tokenIn, tokenOut);
        Pool memory p = pools[id];

        require(p.exists, "Pool does not exist");

        feeBps = getTraderFeeBps(trader);

        if (tokenIn == p.token0 && tokenOut == p.token1) {
            priceImpactBps = getPriceImpactBps(amountIn, p.reserve0);
            amountOut = getAmountOutWithFee(amountIn, p.reserve0, p.reserve1, feeBps);
            return (amountOut, feeBps, priceImpactBps);
        }

        if (tokenIn == p.token1 && tokenOut == p.token0) {
            priceImpactBps = getPriceImpactBps(amountIn, p.reserve1);
            amountOut = getAmountOutWithFee(amountIn, p.reserve1, p.reserve0, feeBps);
            return (amountOut, feeBps, priceImpactBps);
        }

        revert("Invalid pair");
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external onlyActiveCompetition returns (uint256 amountOut) {
        require(isTrader[msg.sender], "Not registered trader");
        require(amountIn > 0, "Invalid amount");

        require(
            block.timestamp >= traderLastTradeAt[msg.sender] + COOLDOWN_SECONDS,
            "Trader cooldown active"
        );

        bytes32 id = _poolId(tokenIn, tokenOut);
        Pool storage p = pools[id];

        require(p.exists, "Pool does not exist");

        bool normalDirection = tokenIn == p.token0 && tokenOut == p.token1;
        bool reverseDirection = tokenIn == p.token1 && tokenOut == p.token0;

        require(normalDirection || reverseDirection, "Invalid pair");

        uint256 reserveIn = normalDirection ? p.reserve0 : p.reserve1;
        uint256 reserveOut = normalDirection ? p.reserve1 : p.reserve0;

        uint256 impactBps = getPriceImpactBps(amountIn, reserveIn);
        require(impactBps <= MAX_PRICE_IMPACT_BPS, "Price impact too high");

        uint256 feeBps = getTraderFeeBps(msg.sender);
        uint256 feeAmount = (amountIn * feeBps) / BPS_DENOMINATOR;

        amountOut = getAmountOutWithFee(amountIn, reserveIn, reserveOut, feeBps);

        require(amountOut >= minAmountOut, "Slippage exceeded");
        require(amountOut < reserveOut, "Insufficient liquidity");

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(msg.sender, amountOut);

        traderTradeCount[msg.sender] += 1;
        traderLastTradeAt[msg.sender] = block.timestamp;
        traderFeesPaid[msg.sender] += feeAmount;
        totalFeesPaid += feeAmount;

        if (normalDirection) {
            p.reserve0 += amountIn;
            p.reserve1 -= amountOut;

            emit Swapped(
                msg.sender,
                id,
                tokenIn,
                tokenOut,
                amountIn,
                amountOut,
                p.reserve0,
                p.reserve1
            );
        } else {
            p.reserve1 += amountIn;
            p.reserve0 -= amountOut;

            emit Swapped(
                msg.sender,
                id,
                tokenIn,
                tokenOut,
                amountIn,
                amountOut,
                p.reserve1,
                p.reserve0
            );
        }

        emit FeeCharged(msg.sender, id, tokenIn, feeBps, feeAmount);
    }

    function registerTraders(address[] calldata traders) external onlyOwner {
        for (uint256 i = 0; i < traders.length; i++) {
            require(traders[i] != address(0), "Invalid trader");

            if (!isTrader[traders[i]]) {
                isTrader[traders[i]] = true;
                traderCount++;
            }
        }
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

    function getCompetitionStatus()
        external
        view
        returns (
            uint8 status,
            uint256 startTime,
            uint256 endTime
        )
    {
        return (
            uint8(getCurrentCompetitionStatus()),
            competitionStartTime,
            competitionEndTime
        );
    }

    function startCompetition(uint256 durationSeconds) external onlyOwner {
        CompetitionStatus currentStatus = getCurrentCompetitionStatus();

        require(
            currentStatus == CompetitionStatus.NOT_STARTED ||
            currentStatus == CompetitionStatus.ENDED,
            "Competition already active"
        );

        require(durationSeconds > 0, "Invalid duration");

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
        require(getCurrentCompetitionStatus() == CompetitionStatus.ACTIVE, "Competition not active");

        competitionStatus = CompetitionStatus.ENDED;
        competitionEndTime = block.timestamp;

        emit CompetitionEnded(block.timestamp);
    }
}