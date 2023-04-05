// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {IOlympus} from "../../interfaces/oracles/IOlympus.sol";
import {ChainlinkBasic2} from "./ChainlinkBasic2.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports olympus gOhm oracles which are compatible with v2v3 or v3 interfaces
 * should only be utilized with eth based oracles, not usd-based oracles
 */
contract OlympusOracle2 is IOracle, ChainlinkBasic2 {
    address internal constant OHM_ADDR =
        0x0ab87046fBb341D058F17CBC4c1133F25a20a52f;
    address internal constant GOHM_ADDR =
        0x0ab87046fBb341D058F17CBC4c1133F25a20a52f;
    uint256 internal constant SOHM_DECIMALS = 9;
    address internal constant ETH_OHM_ORACLE_ADDR =
        0x9a72298ae3886221820B1c878d12D872087D3a23;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs
    )
        ChainlinkBasic2(
            _tokenAddrs,
            _oracleAddrs,
            0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2, // weth address
            1e18 // 18 decimals for ETH based oracles
        )
    {
        oracleAddrs[OHM_ADDR] = ETH_OHM_ORACLE_ADDR;
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
        if (collToken != GOHM_ADDR && loanToken != GOHM_ADDR) {
            revert Errors.NeitherTokenIsGOHM();
        }
        bool isColl = collToken == GOHM_ADDR;
        uint256 priceOfCollToken = getPriceOfToken(
            isColl ? OHM_ADDR : collToken
        );
        uint256 priceOfLoanToken = getPriceOfToken(
            isColl ? loanToken : OHM_ADDR
        );
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();
        uint256 index = IOlympus(GOHM_ADDR).index();

        collTokenPriceInLoanToken = isColl
            ? (priceOfCollToken * (10 ** loanTokenDecimals) * index) /
                (priceOfLoanToken * (10 ** SOHM_DECIMALS))
            : (priceOfCollToken *
                (10 ** loanTokenDecimals) *
                (10 ** SOHM_DECIMALS)) / (priceOfLoanToken * index);
    }
}
