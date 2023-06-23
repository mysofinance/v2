// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

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
    address internal constant WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs
    )
        ChainlinkBasic(
            _tokenAddrs,
            _oracleAddrs,
            WBTC,
            1e8 // 8 decimals for USD based oracles
        )
    {}

    function _getPriceOfToken(
        address token
    ) internal view override returns (uint256 tokenPriceRaw) {
        if (token == BASE_CURRENCY) {
            uint256 answer1 = _checkAndReturnLatestRoundData(WBTC_BTC_ORACLE);
            uint256 answer2 = _checkAndReturnLatestRoundData(BTC_USD_ORACLE);
            tokenPriceRaw = (answer1 * answer2) / BASE_CURRENCY_UNIT;
        } else {
            tokenPriceRaw = super._getPriceOfToken(token);
        }
    }
}
