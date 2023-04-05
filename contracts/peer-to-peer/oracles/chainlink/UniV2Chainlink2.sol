// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {IUniV2} from "../../interfaces/oracles/IUniV2.sol";
import {ChainlinkBasic2} from "./ChainlinkBasic2.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports oracles which have one token which is a 50/50 LP token
 * compatible with v2v3 or v3 interfaces
 * should only be utilized with eth based oracles, not usd-based oracles
 */
contract UniV2Chainlink2 is IOracle, ChainlinkBasic2 {
    mapping(address => bool) public isLpToken;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address[] memory _lpAddrs
    )
        ChainlinkBasic2(
            _tokenAddrs,
            _oracleAddrs,
            0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,
            1e18
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
        override(ChainlinkBasic2, IOracle)
        returns (uint256 collTokenPriceInLoanToken)
    {
        if (!isLpToken[collToken] && !isLpToken[loanToken]) {
            revert Errors.NoLpTokens();
        }
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();
        uint256 collTokenPriceRaw;
        uint256 loanTokenPriceRaw;
        if (isLpToken[collToken]) {
            collTokenPriceRaw = getLpTokenPrice(collToken, true);
        } else {
            collTokenPriceRaw = getPriceOfToken(collToken);
        }

        if (isLpToken[loanToken]) {
            loanTokenPriceRaw = getLpTokenPrice(loanToken, false);
        } else {
            loanTokenPriceRaw = getPriceOfToken(loanToken);
        }

        collTokenPriceInLoanToken =
            (collTokenPriceRaw * (10 ** loanTokenDecimals)) /
            (loanTokenPriceRaw);
    }

    function getLpTokenPrice(
        address lpToken,
        bool isColl
    ) internal view returns (uint256 lpTokenPriceInEth) {
        uint256 unsignedLpTokenPriceInEth = getTotalEthValue(lpToken, isColl);
        uint256 lpTokenDecimals = IERC20Metadata(lpToken).decimals();
        uint256 totalLpSupply = IUniV2(lpToken).totalSupply();
        lpTokenPriceInEth =
            (unsignedLpTokenPriceInEth * (10 ** lpTokenDecimals)) /
            totalLpSupply;
        if (lpTokenPriceInEth < 1) {
            revert Errors.InvalidOracleAnswer();
        }
    }

    function getTotalEthValue(
        address lpToken,
        bool isColl
    ) internal view returns (uint256 ethValueBounded) {
        (uint112 reserve0, uint112 reserve1, ) = IUniV2(lpToken).getReserves();
        (address token0, address token1) = (
            IUniV2(lpToken).token0(),
            IUniV2(lpToken).token1()
        );
        uint256 decimalsToken0 = IERC20Metadata(token0).decimals();
        uint256 decimalsToken1 = IERC20Metadata(token1).decimals();
        uint256 token0PriceRaw = getPriceOfToken(token0);
        uint256 token1PriceRaw = getPriceOfToken(token1);

        uint256 totalEthValueToken0 = (uint256(reserve0) * token0PriceRaw) /
            (10 ** decimalsToken0);
        uint256 totalEthValueToken1 = (uint256(reserve1) * token1PriceRaw) /
            (10 ** decimalsToken1);

        if (isColl) {
            // for collateral LP tokens use the lower bound (since coll token in numerator)
            ethValueBounded = totalEthValueToken0 > totalEthValueToken1
                ? totalEthValueToken1 * 2
                : totalEthValueToken0 * 2;
        } else {
            // for loan LP tokens use the upper bound (since loan token is in denominator)
            ethValueBounded = totalEthValueToken0 > totalEthValueToken1
                ? totalEthValueToken0 * 2
                : totalEthValueToken1 * 2;
        }
    }
}
