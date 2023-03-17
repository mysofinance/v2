// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../interfaces/IOracle.sol";
import {Errors} from "../../Errors.sol";

abstract contract BaseOracle {
    address internal immutable wethAddrOfGivenChain;
    // tokenAddr => chainlink oracle addr
    // oracles will be eth or usd based
    mapping(address => address) public oracleAddrs;
    bool public isUSDBased;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address _wethAddrOfGivenChain
    ) {
        if (_wethAddrOfGivenChain == address(0)) {
            revert Errors.InvalidAddress();
        }
        wethAddrOfGivenChain = _wethAddrOfGivenChain;
        isUSDBased = _wethAddrOfGivenChain == address(0);
        // if you use eth oracles with weth, will just return weth address
        // for usd-based oracle weth/usd oracle addr will need to be passed in like others
        if (!isUSDBased) {
            oracleAddrs[_wethAddrOfGivenChain] = _wethAddrOfGivenChain;
        }
        if (
            _tokenAddrs.length == 0 || _tokenAddrs.length != _oracleAddrs.length
        ) {
            revert Errors.InvalidArrayLength();
        }
        uint8 oracleDecimals;
        uint256 version;
        for (uint i = 0; i < _oracleAddrs.length; ) {
            if (_tokenAddrs[i] == address(0) || _oracleAddrs[i] == address(0)) {
                revert Errors.InvalidAddress();
            }
            oracleDecimals = AggregatorV3Interface(_oracleAddrs[i]).decimals();
            if (
                (isUSDBased && oracleDecimals != 8) ||
                (!isUSDBased && oracleDecimals != 18)
            ) {
                revert Errors.InvalidOracleDecimals();
            }
            version = AggregatorV3Interface(_oracleAddrs[i]).version();
            if (version != 4) {
                revert Errors.InvalidOracleVersion();
            }
            oracleAddrs[_tokenAddrs[i]] = _oracleAddrs[i];
            unchecked {
                ++i;
            }
        }
    }

    function getPriceOfToken(
        address oracleAddr,
        address wethAddress
    ) internal view returns (uint256 tokenPriceRaw) {
        int256 answer;
        if (oracleAddr == wethAddress) {
            answer = 10 ** 18;
        } else {
            (, answer, , , ) = AggregatorV3Interface(oracleAddr)
                .latestRoundData();
        }
        tokenPriceRaw = uint256(answer);
        if (tokenPriceRaw < 1) {
            revert Errors.InvalidOracleAnswer();
        }
    }
}
