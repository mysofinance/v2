// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../interfaces/oracles/AggregatorV3Interface.sol";
import {IOracle} from "../interfaces/IOracle.sol";

/**
 * @dev supports oracles which are compatible with v2v3 or v3 interfaces
 */
contract ChainlinkBasic is IOracle {
    address public owner;
    // tokenAddr => chainlink oracle addr in eth
    mapping(address => OracleData) public ethOracleAddrs;
    // tokenAddr => chainlink oracle addr in usd($)
    mapping(address => OracleData) public usdOracleAddrs;

    struct OracleData {
        address oracleAddr;
        uint40 timestampValid;
    }

    error InvalidOraclePair();
    error InvalidSender();
    error InvalidAddress();
    error InvalidArrayLength();
    error OracleAlreadySet();

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        bool[] memory _isEth
    ) {
        owner = msg.sender;
        if (
            _tokenAddrs.length != _oracleAddrs.length ||
            _tokenAddrs.length != _isEth.length
        ) {
            revert InvalidArrayLength();
        }
        for (uint i = 0; i < _oracleAddrs.length; ) {
            if (_tokenAddrs[i] == address(0) || _oracleAddrs[i] == address(0)) {
                revert InvalidAddress();
            }
            if (_isEth[i]) {
                ethOracleAddrs[_tokenAddrs[i]] = OracleData({
                    oracleAddr: _oracleAddrs[i],
                    timestampValid: uint40(block.timestamp)
                });
            } else {
                usdOracleAddrs[_tokenAddrs[i]] = OracleData({
                    oracleAddr: _oracleAddrs[i],
                    timestampValid: uint40(block.timestamp)
                });
            }
            unchecked {
                ++i;
            }
        }
    }

    function setOracleAddrs(
        address[] memory tokenAddrs,
        address[] memory oracleAddrs,
        bool[] memory isEth
    ) external {
        if (msg.sender != owner) {
            revert InvalidSender();
        }
        if (
            tokenAddrs.length == 0 ||
            tokenAddrs.length != oracleAddrs.length ||
            tokenAddrs.length != isEth.length
        ) {
            revert InvalidArrayLength();
        }
        for (uint i = 0; i < oracleAddrs.length; ) {
            if (tokenAddrs[i] == address(0) || oracleAddrs[i] == address(0)) {
                revert InvalidAddress();
            }
            if (isEth[i]) {
                if (ethOracleAddrs[tokenAddrs[i]].oracleAddr != address(0)) {
                    revert OracleAlreadySet();
                }
                ethOracleAddrs[tokenAddrs[i]] = OracleData({
                    oracleAddr: oracleAddrs[i],
                    timestampValid: uint40(block.timestamp + 86400)
                });
            } else {
                if (usdOracleAddrs[tokenAddrs[i]].oracleAddr != address(0)) {
                    revert OracleAlreadySet();
                }
                usdOracleAddrs[tokenAddrs[i]] = OracleData({
                    oracleAddr: oracleAddrs[i],
                    timestampValid: uint40(block.timestamp + 86400)
                });
            }
            unchecked {
                ++i;
            }
        }
    }

    function getPrice(
        address collToken,
        address loanToken
    ) external view returns (uint256 collTokenPriceInLoanToken) {
        (
            bool isValid,
            address loanTokenOracleAddr,
            address collTokenOracleAddr
        ) = checkValidOraclePair(collToken, loanToken);
        if (!isValid) {
            revert InvalidOraclePair();
        }
        collTokenPriceInLoanToken = calculatePrice(
            loanTokenOracleAddr,
            collTokenOracleAddr,
            loanToken
        );
    }

    function checkValidOraclePair(
        address collToken,
        address loanToken
    )
        internal
        view
        returns (
            bool isValid,
            address loanTokenOracleAddr,
            address collTokenOracleAddr
        )
    {
        uint256 currTimestamp = block.timestamp;
        // try to see if both have non-zero ethOracleAddrs
        OracleData memory loanTokenOracleData = ethOracleAddrs[loanToken];
        OracleData memory collTokenOracleData = ethOracleAddrs[collToken];
        loanTokenOracleAddr = loanTokenOracleData.oracleAddr;
        collTokenOracleAddr = collTokenOracleData.oracleAddr;
        isValid =
            loanTokenOracleAddr != address(0) &&
            collTokenOracleAddr != address(0) &&
            currTimestamp > loanTokenOracleData.timestampValid &&
            currTimestamp > collTokenOracleData.timestampValid;
        if (isValid) {
            return (isValid, loanTokenOracleAddr, collTokenOracleAddr);
        }
        // now try usd oracle addresses
        loanTokenOracleData = usdOracleAddrs[loanToken];
        collTokenOracleData = usdOracleAddrs[collToken];
        loanTokenOracleAddr = loanTokenOracleData.oracleAddr;
        collTokenOracleAddr = collTokenOracleData.oracleAddr;
        isValid =
            loanTokenOracleAddr != address(0) &&
            collTokenOracleAddr != address(0) &&
            currTimestamp > loanTokenOracleData.timestampValid &&
            currTimestamp > collTokenOracleData.timestampValid;
    }

    function calculatePrice(
        address loanTokenOracleAddr,
        address collTokenOracleAddr,
        address loanToken
    ) internal view returns (uint256 collTokenPriceInLoanToken) {
        int256 answer;
        uint256 updatedAt;
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();

        (, answer, , updatedAt, ) = AggregatorV3Interface(loanTokenOracleAddr)
            .latestRoundData();
        uint256 loanTokenOracleDecimals = AggregatorV3Interface(
            loanTokenOracleAddr
        ).decimals();
        // todo: decide on logic check for updatedAt versus current timestamp?
        uint256 loanTokenPriceRaw = uint256(answer);
        (, answer, , updatedAt, ) = AggregatorV3Interface(collTokenOracleAddr)
            .latestRoundData();
        uint256 collTokenOracleDecimals = AggregatorV3Interface(
            collTokenOracleAddr
        ).decimals();
        // todo: decide on logic check for updatedAt versus current timestamp?
        uint256 collTokenPriceRaw = uint256(answer);

        // typically loanTokenOracleDecimals should equal collTokenOracleDecimals
        collTokenPriceInLoanToken =
            (collTokenPriceRaw *
                (10 ** loanTokenDecimals) *
                (10 ** loanTokenOracleDecimals)) /
            (loanTokenPriceRaw * (10 ** collTokenOracleDecimals));
    }
}
