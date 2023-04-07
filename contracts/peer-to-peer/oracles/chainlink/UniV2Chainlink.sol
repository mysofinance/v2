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
        if (!isLpToken[collToken] && !isLpToken[loanToken]) {
            revert Errors.NoLpTokens();
        }
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();
        uint256 collTokenPriceRaw;
        uint256 loanTokenPriceRaw;
        if (isLpToken[collToken]) {
            collTokenPriceRaw = getLpTokenPrice(collToken);
        } else {
            collTokenPriceRaw = getPriceOfToken(collToken);
        }

        if (isLpToken[loanToken]) {
            loanTokenPriceRaw = getLpTokenPrice(loanToken);
        } else {
            loanTokenPriceRaw = getPriceOfToken(loanToken);
        }

        collTokenPriceInLoanToken =
            (collTokenPriceRaw * (10 ** loanTokenDecimals)) /
            (loanTokenPriceRaw);
    }

    function getLpTokenPrice(
        address lpToken
    ) internal view returns (uint256 lpTokenPriceInEth) {
        (uint112 reserve0, uint112 reserve1, ) = IUniV2(lpToken).getReserves();
        (address token0, address token1) = (
            IUniV2(lpToken).token0(),
            IUniV2(lpToken).token1()
        );
        uint256 totalLpSupply = IUniV2(lpToken).totalSupply();
        uint256 lpDecimals = IERC20Metadata(lpToken).decimals();
        uint256 sqrtK = Math.sqrt(reserve0) * Math.sqrt(reserve1);
        uint256 priceToken0 = getPriceOfToken(token0);
        uint256 priceToken1 = getPriceOfToken(token1);
        uint256 token0Factor = 10 ** IERC20Metadata(token0).decimals();
        uint256 token1Factor = 10 ** IERC20Metadata(token1).decimals();
        uint256 fairReserve0 = ((sqrtK) *
            Math.sqrt(priceToken1) *
            Math.sqrt(token0Factor)) /
            (Math.sqrt(priceToken0) * Math.sqrt(token1Factor));
        uint256 fairReserve1 = ((sqrtK) *
            Math.sqrt(priceToken0) *
            Math.sqrt(token1Factor)) /
            (Math.sqrt(priceToken1) * Math.sqrt(token0Factor));

        uint256 lpTokenEthValue = ((fairReserve0 * priceToken0) /
            token0Factor) + ((fairReserve1 * priceToken1) / token1Factor);

        lpTokenPriceInEth =
            (lpTokenEthValue * (10 ** lpDecimals)) /
            totalLpSupply;
    }
}
