// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../interfaces/IOracle.sol";
import {Errors} from "../../Errors.sol";

abstract contract BaseOracle {
    address internal immutable weth;
    // tokenAddr => chainlink oracle addr
    // oracles will be eth or usd based
    mapping(address => address) public oracleAddrs;
    bool public isUSDBased;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address _wethAddr,
        bool _isUSDBased
    ) {
        if (_wethAddr == address(0)) {
            revert Errors.InvalidAddress();
        }
        weth = _wethAddr;
        isUSDBased = _isUSDBased;
        // if you use eth oracles with weth, will just return weth address
        // for usd-based oracle weth/usd oracle addr will need to be passed in like others
        if (!_isUSDBased) {
            oracleAddrs[_wethAddr] = _wethAddr;
        }
        if (_tokenAddrs.length != _oracleAddrs.length) {
            revert Errors.InvalidArrayLength();
        }
        for (uint i = 0; i < _oracleAddrs.length; ) {
            if (_tokenAddrs[i] == address(0) || _oracleAddrs[i] == address(0)) {
                revert Errors.InvalidAddress();
            }
            oracleAddrs[_tokenAddrs[i]] = _oracleAddrs[i];
            unchecked {
                ++i;
            }
        }
    }

    function tokenPriceConvertAndCheck(
        int256 answer
    ) internal view returns (uint256 tokenPriceRaw) {
        tokenPriceRaw = uint256(answer);
        if (tokenPriceRaw < 1) {
            revert Errors.InvalidOracleAnswer();
        }
    }
}
