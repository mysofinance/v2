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
    mapping(address => address) public ethOracleAddrs;
    // tokenAddr => chainlink oracle addr in usd($)
    mapping(address => address) public usdOracleAddrs;

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
                ethOracleAddrs[_tokenAddrs[i]] = _oracleAddrs[i];
            } else {
                usdOracleAddrs[_tokenAddrs[i]] = _oracleAddrs[i];
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
                if (ethOracleAddrs[tokenAddrs[i]] != address(0)) {
                    revert OracleAlreadySet();
                }
                ethOracleAddrs[tokenAddrs[i]] = oracleAddrs[i];
            } else {
                if (usdOracleAddrs[tokenAddrs[i]] != address(0)) {
                    revert OracleAlreadySet();
                }
                usdOracleAddrs[tokenAddrs[i]] = oracleAddrs[i];
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
        // try to see if both have non-zero ethOracleAddrs
        loanTokenOracleAddr = ethOracleAddrs[loanToken];
        collTokenOracleAddr = ethOracleAddrs[collToken];
        isValid =
            loanTokenOracleAddr != address(0) &&
            collTokenOracleAddr != address(0);
        if (isValid) {
            return (isValid, loanTokenOracleAddr, collTokenOracleAddr);
        }
        // now try usd oracle addresses
        loanTokenOracleAddr = usdOracleAddrs[loanToken];
        collTokenOracleAddr = usdOracleAddrs[collToken];
        isValid =
            loanTokenOracleAddr != address(0) &&
            collTokenOracleAddr != address(0);
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
            (loanTokenPriceRaw *
                (10 ** loanTokenDecimals) *
                (10 ** collTokenOracleDecimals)) /
            (collTokenPriceRaw * (10 ** loanTokenOracleDecimals));
    }
}
