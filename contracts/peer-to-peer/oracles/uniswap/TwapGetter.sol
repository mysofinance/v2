// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {FixedPoint96} from "@uniswap/v3-core/contracts/libraries/FixedPoint96.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {FullMath} from "./FullMath.sol"; // cannot import from @uniswap due to incompatible versions
import {TickMath} from "./TickMath.sol"; // cannot import from @uniswap due to incompatible versions
import {Errors} from "../../../Errors.sol";
import {ITwapGetter} from "../../interfaces/oracles/uniswap/ITwapGetter.sol";

abstract contract TwapGetter is ITwapGetter {
    // inToken: `1 unit of inToken`
    // outToken: resulting units of outToken (in "base unit" of outTokens, e.g. if 427518869723400 and outToken is eth, then this corresponds to 427518869723400/10^18)
    function getTwap(
        address inToken,
        address outToken,
        uint32 twapInterval,
        address uniswapV3Pool
    ) public view returns (uint256 twap) {
        (address token0, address token1) = inToken < outToken
            ? (inToken, outToken)
            : (outToken, inToken);

        // note: this returns the sqrt price
        uint160 sqrtPriceX96 = getSqrtTwapX96(uniswapV3Pool, twapInterval);

        // note: this returns the price in base 2**96 and denominated in token1
        // i.e., `1 unit of token0` corresponds to `sqrtPriceX96 units (divided by 2**96) of token1`
        uint256 priceX96 = getPriceX96FromSqrtPriceX96(sqrtPriceX96);

        (uint256 nominator, uint256 denominator) = inToken == token0
            ? (
                priceX96 * 10 ** IERC20Metadata(token0).decimals(),
                FixedPoint96.Q96
            )
            : (
                FixedPoint96.Q96 * 10 ** IERC20Metadata(token1).decimals(),
                priceX96
            );
        twap = FullMath.mulDiv(nominator, 1, denominator);
    }

    function getSqrtTwapX96(
        address uniswapV3Pool,
        uint32 twapInterval
    ) public view returns (uint160 sqrtPriceX96) {
        if (twapInterval == 0) {
            (sqrtPriceX96, , , , , , ) = IUniswapV3Pool(uniswapV3Pool).slot0();
        } else {
            uint32[] memory secondsAgo = new uint32[](2);

            // @dev: revert if twapInterval doesn't fit into smaller int32
            if (twapInterval > uint32(type(int32).max)) {
                revert Errors.TooLongTwapInterval();
            }

            secondsAgo[0] = twapInterval;
            secondsAgo[1] = 0;
            (int56[] memory tickCumulatives, ) = IUniswapV3Pool(uniswapV3Pool)
                .observe(secondsAgo);

            int56 tickCumulativesDelta = tickCumulatives[1] -
                tickCumulatives[0];
            int24 averageTick = SafeCast.toInt24(
                tickCumulativesDelta / int32(twapInterval)
            );

            sqrtPriceX96 = TickMath.getSqrtRatioAtTick(averageTick);
        }
    }

    function getPriceX96FromSqrtPriceX96(
        uint160 sqrtPriceX96
    ) public pure returns (uint256 priceX96) {
        return FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, FixedPoint96.Q96);
    }

    function getPriceFromSqrtPriceX96(
        uint160 sqrtPriceX96,
        uint256 decimals
    ) public pure returns (uint256 price) {
        return
            (FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, FixedPoint96.Q96) *
                (10 ** decimals)) / FixedPoint96.Q96;
    }
}
