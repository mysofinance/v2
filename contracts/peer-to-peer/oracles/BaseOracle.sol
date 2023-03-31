// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../interfaces/IOracle.sol";
import {Errors} from "../../Errors.sol";

abstract contract BaseOracle {
    address internal immutable wethAddrOfGivenChain;
    // since arbitrum and eth support BTC/USD and wBTC/BTC only use USD oracles
    address internal immutable wBtcAddrOfGivenChain;
    address internal immutable btcToUsdOracleAddrOfGivenChain;
    address internal immutable wBtcToBtcOracleAddrOfGivenChain;
    // tokenAddr => chainlink oracle addr
    // oracles will be eth or usd based
    mapping(address => address) public oracleAddrs;
    bool public immutable isUSDBased;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address _wethAddrOfGivenChain,
        address _wBtcAddrOfGivenChain,
        address _btcToUsdOracleAddrOfGivenChain,
        address _wBtcToBtcOracleAddrOfGivenChain
    ) {
        wethAddrOfGivenChain = _wethAddrOfGivenChain;
        isUSDBased = _wethAddrOfGivenChain == address(0);
        wBtcAddrOfGivenChain = _wBtcAddrOfGivenChain;
        btcToUsdOracleAddrOfGivenChain = _btcToUsdOracleAddrOfGivenChain;
        wBtcToBtcOracleAddrOfGivenChain = _wBtcToBtcOracleAddrOfGivenChain;
        // if you use eth oracles with weth, will just return weth address
        // for usd-based oracle weth/usd oracle addr will need to be passed in like others
        if (isUSDBased) {
            oracleAddrs[_wBtcAddrOfGivenChain] = _wBtcAddrOfGivenChain;
        } else {
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

    /**
     * @notice helper function to get price across weth/eth, btc or other cases
     * @dev this performs a check to make sure only positive values are returned from oracle
     * @param oracleAddr address of the chainlink oracle
     * @return tokenPriceRaw return value of token price
     */
    function getPriceOfToken(
        address oracleAddr
    ) internal view returns (uint256 tokenPriceRaw) {
        if (oracleAddr == wethAddrOfGivenChain) {
            tokenPriceRaw = 10 ** 18;
        } else if (oracleAddr == wBtcAddrOfGivenChain) {
            tokenPriceRaw = getWbtcPrice();
        } else {
            (
                uint80 roundId,
                int256 answer,
                ,
                uint256 updatedAt,
                uint80 answeredInRound
            ) = AggregatorV3Interface(oracleAddr).latestRoundData();
            tokenPriceRaw = checkChainlinkAnswerAndCastToUint256(
                roundId,
                answer,
                updatedAt,
                answeredInRound
            );
        }
    }

    /**
     * @dev this functon first retrieves btc price in USD
     * the wbtc price is retreived denominated in btc
     * wbtc/usd = (wbtc/btc * btc/usd)/(10**8)
     * denominator accounts for 8 decimals of btc
     * @return answer price of wbtc in USD which has 8 oracle decimals
     */
    function getWbtcPrice() internal view returns (uint256 answer) {
        (
            uint80 roundId,
            int256 btcUSDAnswer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = AggregatorV3Interface(btcToUsdOracleAddrOfGivenChain)
                .latestRoundData();
        uint256 uBtcUSDAnswer = checkChainlinkAnswerAndCastToUint256(
            roundId,
            btcUSDAnswer,
            updatedAt,
            answeredInRound
        );
        int256 wBtcBtcAnswer;
        (
            roundId,
            wBtcBtcAnswer,
            ,
            updatedAt,
            answeredInRound
        ) = AggregatorV3Interface(wBtcToBtcOracleAddrOfGivenChain)
            .latestRoundData();
        uint256 uWbtcBtcAnswer = checkChainlinkAnswerAndCastToUint256(
            roundId,
            wBtcBtcAnswer,
            updatedAt,
            answeredInRound
        );
        answer = (uWbtcBtcAnswer * uBtcUSDAnswer) / (10 ** 8);
    }

    /**
     * @dev oracles for btc should only be with USD based oracles,
     * since that is the only cross-chain support provided by chainlink
     * across mainnet and arbitrum
     * @param collToken address of coll token
     * @param loanToken address of loan token
     */
    function validBtcCheck(address collToken, address loanToken) internal view {
        if (
            (loanToken == wBtcAddrOfGivenChain ||
                collToken == wBtcAddrOfGivenChain) && !isUSDBased
        ) {
            revert Errors.InvalidBTCOracle();
        }
    }

    /**
     * @dev helper function to check if oracle price is valid
     * @param roundId round id of latest round
     * @param answer answer of latest round
     * @param updatedAt timestamp of latest round
     * @param answeredInRound round id last answered
     * @return checkedAnswer checked and cast answer
     */
    function checkChainlinkAnswerAndCastToUint256(
        uint80 roundId,
        int256 answer,
        uint256 updatedAt,
        uint80 answeredInRound
    ) internal pure returns (uint256 checkedAnswer) {
        if (updatedAt == 0 || answeredInRound < roundId || answer < 1) {
            revert Errors.InvalidOracleAnswer();
        }
        checkedAnswer = uint256(answer);
    }
}
