// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../interfaces/IOracle.sol";
import {Errors} from "../../Errors.sol";

abstract contract BaseOracle {
    address internal immutable wethAddrOfGivenChain;
    // since arbitrum and eth support BTC/USD and wBTC/BTC only use on USD oracles
    address internal immutable wBTCAddrOfGivenChain;
    address internal immutable btcToUSDOracleAddrOfGivenChain;
    address internal immutable wBTCToBTCOracleAddrOfGivenChain;
    // tokenAddr => chainlink oracle addr
    // oracles will be eth or usd based
    mapping(address => address) public oracleAddrs;
    bool public isUSDBased;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address _wethAddrOfGivenChain,
        address _wBTCAddrOfGivenChain,
        address _btcToUSDOracleAddrOfGivenChain,
        address _wBTCToBTCOracleAddrOfGivenChain
    ) {
        if (_wethAddrOfGivenChain == address(0)) {
            revert Errors.InvalidAddress();
        }
        wethAddrOfGivenChain = _wethAddrOfGivenChain;
        isUSDBased = _wethAddrOfGivenChain == address(0);
        wBTCAddrOfGivenChain = _wBTCAddrOfGivenChain;
        btcToUSDOracleAddrOfGivenChain = _btcToUSDOracleAddrOfGivenChain;
        wBTCToBTCOracleAddrOfGivenChain = _wBTCToBTCOracleAddrOfGivenChain;
        // if you use eth oracles with weth, will just return weth address
        // for usd-based oracle weth/usd oracle addr will need to be passed in like others
        if (!isUSDBased) {
            oracleAddrs[_wethAddrOfGivenChain] = _wethAddrOfGivenChain;
        }
        if (isUSDBased) {
            oracleAddrs[_wBTCAddrOfGivenChain] = _wBTCAddrOfGivenChain;
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
        address oracleAddr
    ) internal view returns (uint256 tokenPriceRaw) {
        int256 answer;
        if (oracleAddr == wethAddrOfGivenChain) {
            answer = 10 ** 18;
        } else if (oracleAddr == wBTCAddrOfGivenChain) {
            answer = getBTCPrice();
        } else {
            (, answer, , , ) = AggregatorV3Interface(oracleAddr)
                .latestRoundData();
        }
        tokenPriceRaw = uint256(answer);
        if (tokenPriceRaw < 1) {
            revert Errors.InvalidOracleAnswer();
        }
    }

    function getBTCPrice() internal view returns (int256 answer) {
        (, int256 BTCUSDAnswer, , , ) = AggregatorV3Interface(
            btcToUSDOracleAddrOfGivenChain
        ).latestRoundData();
        (, int256 wBTCBTCAnswer, , , ) = AggregatorV3Interface(
            wBTCToBTCOracleAddrOfGivenChain
        ).latestRoundData();
        answer = (wBTCBTCAnswer * BTCUSDAnswer) / (10 ** 8);
    }

    function validBTCCheck(address loanToken, address collToken) internal view {
        if (
            (loanToken == wBTCAddrOfGivenChain ||
                collToken == wBTCAddrOfGivenChain) && !isUSDBased
        ) {
            revert Errors.InvalidBTCOracle();
        }
    }
}
