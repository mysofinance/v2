// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface ITwapGetter {
    /**
     * @dev returns the twap for the given uniswap v3 pool
     * @param inToken Address of the In Token
     * @param outToken Address of the Out Token
     * @param twapInterval Time interval for the twap
     * @param uniswapV3Pool Address of the Uniswap V3 Pool
     * @return twap The twap for the given uniswap v3 pool
     */
    function getTwap(
        address inToken,
        address outToken,
        uint32 twapInterval,
        address uniswapV3Pool
    ) external view returns (uint256 twap);

    /**
     * @dev returns the sqrt twap for the given uniswap v3 pool
     * @param uniswapV3Pool Address of the Uniswap V3 Pool
     * @param twapInterval Time interval for the twap
     * @return sqrtTwapPriceX96 The sqrt twap for the given uniswap v3 pool
     */
    function getSqrtTwapX96(
        address uniswapV3Pool,
        uint32 twapInterval
    ) external view returns (uint160 sqrtTwapPriceX96);

    /**
     * @dev returns the priceX96 for the given sqrtPriceX96
     * @notice priceX96 is the price in base 2**96
     * @param sqrtPriceX96 The sqrt price for the given uniswap v3 pool
     * @return priceX96 The priceX96 for the given sqrtPriceX96
     */
    function getPriceX96FromSqrtPriceX96(
        uint160 sqrtPriceX96
    ) external pure returns (uint256 priceX96);

    /**
     * @dev returns the price for the given sqrtPriceX96
     * @param sqrtPriceX96 The sqrt price for the given uniswap v3 pool
     * @param decimals The decimals for shifting the price
     * @return price The price for the given sqrtPriceX96
     */
    function getPriceFromSqrtPriceX96(
        uint160 sqrtPriceX96,
        uint256 decimals
    ) external pure returns (uint256 price);
}
