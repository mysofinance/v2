// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ChainlinkBase} from "../chainlink/ChainlinkBase.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports oracles which are compatible with v2v3 or v3 interfaces
 */
contract IndexCoopOracle is ChainlinkBase {
    // solhint-disable no-empty-blocks

    address[] public _uniswapV3PairAddrs;
    address internal constant DS_ETH =
        0x341c05c0E9b33C0E38d64de76516b2Ce970bB3BE;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    uint256 internal constant INDEX_COOP_BASE_CURRENCY_UNIT = 1e18; // 18 decimals for ETH based oracles

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address[] memory _uniswapV3PairAddrs
    ) ChainlinkBase(_tokenAddrs, _oracleAddrs, INDEX_COOP_BASE_CURRENCY_UNIT) {
        // in future could be possible that all constituents are chainlink compatible
        // so _uniswapV3PairAddrs.length == 0 is allowed
        if (
            _uniswapV3PairAddrs.length + _oracleAddrs.length !=
            _tokenAddrs.length
        ) {
            revert Errors.InvalidArrayLength();
        }
        for (uint i = 0; i < _uniswapV3PairAddrs.length; ) {
            if (_uniswapV3PairAddrs[i] == address(0)) {
                revert Errors.InvalidAddress();
            }
            _uniswapV3PairAddrs[i] = _uniswapV3PairAddrs[i];
            unchecked {
                ++i;
            }
        }
    }

    function _getPriceOfToken(
        address token
    ) internal view virtual override returns (uint256 tokenPriceRaw) {
        tokenPriceRaw = token == BASE_CURRENCY
            ? BASE_CURRENCY_UNIT
            : super._getPriceOfToken(token);
    }
}
