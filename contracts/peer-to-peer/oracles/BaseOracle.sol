// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {Errors} from "../../Errors.sol";

abstract contract BaseOracle {
    address internal immutable weth;
    // tokenAddr => chainlink oracle addr in eth
    mapping(address => address) public ethOracleAddrs;
    // tokenAddr => chainlink oracle addr in usd($)
    mapping(address => address) public usdOracleAddrs;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address _wethAddr,
        bool hasUSDOracles,
        bool[] memory _isEth
    ) {
        if (_wethAddr == address(0)) {
            revert Errors.InvalidAddress();
        }
        weth = _wethAddr;
        // if you use eth oracles with weth, will just return weth address
        ethOracleAddrs[_wethAddr] = _wethAddr;
        if (
            _tokenAddrs.length != _oracleAddrs.length ||
            (hasUSDOracles && (_tokenAddrs.length != _isEth.length))
        ) {
            revert Errors.InvalidArrayLength();
        }
        for (uint i = 0; i < _oracleAddrs.length; ) {
            if (_tokenAddrs[i] == address(0) || _oracleAddrs[i] == address(0)) {
                revert Errors.InvalidAddress();
            }
            if (hasUSDOracles) {
                if (_isEth[i]) {
                    ethOracleAddrs[_tokenAddrs[i]] = _oracleAddrs[i];
                } else {
                    usdOracleAddrs[_tokenAddrs[i]] = _oracleAddrs[i];
                }
            } else {
                ethOracleAddrs[_tokenAddrs[i]] = _oracleAddrs[i];
            }
            unchecked {
                ++i;
            }
        }
    }
}
