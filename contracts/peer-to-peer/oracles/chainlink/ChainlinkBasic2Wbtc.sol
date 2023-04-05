// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {ChainlinkBasic2} from "./ChainlinkBasic2.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports oracles which are compatible with v2v3 or v3 interfaces
 */
contract ChainlinkBasic2Wbtc is ChainlinkBasic2 {
    // solhint-disable no-empty-blocks
    address internal constant WBTC_BTC_ORACLE =
        0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23;
    address internal constant BTC_USD_ORACLE =
        0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs
    )
        ChainlinkBasic2(
            _tokenAddrs,
            _oracleAddrs,
            0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599, // wbtc address
            1e8 // 8 decimals for USD based oracles
        )
    {}

    function getPriceOfToken(
        address token
    ) internal view override(ChainlinkBasic2) returns (uint256 tokenPriceRaw) {
        if (token == BASE_CURRENCY) {
            uint80 roundId;
            int256 answer1;
            int256 answer2;
            uint256 updatedAt;
            uint80 answeredInRound;
            (
                roundId,
                answer1,
                ,
                updatedAt,
                answeredInRound
            ) = AggregatorV3Interface(WBTC_BTC_ORACLE).latestRoundData();
            if (updatedAt == 0 || answeredInRound < roundId || answer1 < 1) {
                revert Errors.InvalidOracleAnswer();
            }
            (
                roundId,
                answer2,
                ,
                updatedAt,
                answeredInRound
            ) = AggregatorV3Interface(BTC_USD_ORACLE).latestRoundData();
            if (updatedAt == 0 || answeredInRound < roundId || answer2 < 1) {
                revert Errors.InvalidOracleAnswer();
            }
            tokenPriceRaw =
                (uint256(answer1) * uint256(answer2)) /
                BASE_CURRENCY_UNIT;
        } else {
            address oracleAddr = oracleAddrs[token];
            if (oracleAddr == address(0)) {
                revert Errors.NoOracle();
            }
            (
                uint80 roundId,
                int256 answer,
                ,
                uint256 updatedAt,
                uint80 answeredInRound
            ) = AggregatorV3Interface(oracleAddr).latestRoundData();
            if (updatedAt == 0 || answeredInRound < roundId || answer < 1) {
                revert Errors.InvalidOracleAnswer();
            }
            tokenPriceRaw = uint256(answer);
        }
    }
}
