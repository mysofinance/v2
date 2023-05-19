// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {ChainlinkBasic} from "./ChainlinkBasic.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports oracles which are compatible with v2v3 or v3 interfaces
 */
contract ChainlinkBasicWithWbtc is ChainlinkBasic {
    // solhint-disable no-empty-blocks
    address internal constant WBTC_BTC_ORACLE =
        0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23;
    address internal constant BTC_USD_ORACLE =
        0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        uint256 _underCollateralizationFactor
    )
        ChainlinkBasic(
            _tokenAddrs,
            _oracleAddrs,
            0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599, // wbtc address
            1e8, // 8 decimals for USD based oracles
            _underCollateralizationFactor
        )
    {}

    function getPriceOfToken(
        address token
    ) internal view override(ChainlinkBasic) returns (uint256 tokenPriceRaw) {
        if (token == BASE_CURRENCY) {
            uint256 answer1 = checkAndReturnLatestRoundData(WBTC_BTC_ORACLE);
            uint256 answer2 = checkAndReturnLatestRoundData(BTC_USD_ORACLE);
            tokenPriceRaw = (answer1 * answer2) / BASE_CURRENCY_UNIT;
        } else {
            address oracleAddr = oracleAddrs[token];
            if (oracleAddr == address(0)) {
                revert Errors.NoOracle();
            }
            tokenPriceRaw = checkAndReturnLatestRoundData(oracleAddr);
        }
    }
}
