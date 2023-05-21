// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AggregatorV3Interface} from "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {IUniV2} from "../../interfaces/oracles/IUniV2.sol";
import {ChainlinkBasic} from "./ChainlinkBasic.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports oracles which have one token which is a 50/50 LP token
 * compatible with v2v3 or v3 interfaces
 * should only be utilized with eth based oracles, not usd-based oracles
 */
contract UniV2Chainlink is IOracle, ChainlinkBasic {
    mapping(address => bool) public isLpToken;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address[] memory _lpAddrs
    )
        ChainlinkBasic(
            _tokenAddrs,
            _oracleAddrs,
            0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2, // weth address
            1e18 // 18 decimals for ETH based oracles
        )
    {
        if (_lpAddrs.length == 0) {
            revert Errors.InvalidArrayLength();
        }
        for (uint i = 0; i < _lpAddrs.length; ) {
            if (_lpAddrs[i] == address(0)) {
                revert Errors.InvalidAddress();
            }
            isLpToken[_lpAddrs[i]] = true;
            unchecked {
                ++i;
            }
        }
    }

    function getPrice(
        address collToken,
        address loanToken
    )
        external
        view
        override(ChainlinkBasic, IOracle)
        returns (uint256 collTokenPriceInLoanToken)
    {
        bool isCollTokenLpToken = isLpToken[collToken];
        bool isLoanTokenLpToken = isLpToken[loanToken];
        if (!isCollTokenLpToken && !isLoanTokenLpToken) {
            revert Errors.NoLpTokens();
        }
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();
        uint256 collTokenPriceRaw = isCollTokenLpToken
            ? getLpTokenPrice(collToken)
            : _getPriceOfToken(collToken);
        uint256 loanTokenPriceRaw = isLoanTokenLpToken
            ? getLpTokenPrice(loanToken)
            : _getPriceOfToken(loanToken);

        collTokenPriceInLoanToken =
            (collTokenPriceRaw * (10 ** loanTokenDecimals)) /
            loanTokenPriceRaw;
    }

    /**
     * @notice Returns the price of 1 "whole" LP token (in 1 base currency unit, e.g., 10**18) in ETH
     * @dev Since the uniswap reserves could be skewed in any direction by flash loans,
     * we need to calculate the "fair" reserve of each token in the pool using invariant K
     * and then calculate the price of each token in ETH using the oracle prices for each token
     * @param lpToken Address of LP token
     * @return lpTokenPriceInEth of LP token in ETH
     */
    function getLpTokenPrice(
        address lpToken
    ) public view returns (uint256 lpTokenPriceInEth) {
        // assign uint112 reserves to uint256 to also handle large k invariants
        (uint256 reserve0, uint256 reserve1, ) = IUniV2(lpToken).getReserves();
        if (reserve0 * reserve1 == 0) {
            revert Errors.ZeroReserve();
        }
        (address token0, address token1) = (
            IUniV2(lpToken).token0(),
            IUniV2(lpToken).token1()
        );
        uint256 totalLpSupply = IUniV2(lpToken).totalSupply();
        uint256 priceToken0 = _getPriceOfToken(token0);
        uint256 priceToken1 = _getPriceOfToken(token1);

        // calculate fair LP token price based on "fair reserves" as described in
        // https://blog.alphaventuredao.io/fair-lp-token-pricing/
        // formula: p = 2 * sqrt(r0 * r1) * sqrt(p0) * sqrt(p1) / s
        // note: price is for 1 "whole" LP token unit, hence need to scale up by LP token decimals;
        // need to divide by sqrt reserve decimals to cancel out units of invariant k
        // IMPORTANT: while formula is robust against typical flashloan skews, lenders should us this
        // oracle with caution and take into account skew scenarios when setting their LTVs
        lpTokenPriceInEth =
            (2 *
                Math.sqrt(reserve0 * reserve1) *
                Math.sqrt(priceToken0 * priceToken1) *
                10 ** IERC20Metadata(lpToken).decimals()) /
            totalLpSupply /
            Math.sqrt(
                10 ** IERC20Metadata(token0).decimals() *
                    10 ** IERC20Metadata(token1).decimals()
            );
    }
}
