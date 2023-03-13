// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";

/**
 * @dev supports oracles which are compatible with v2v3 or v3 interfaces
 */
contract ChainlinkBasic is IOracle {
    // tokenAddr => chainlink oracle addr in eth
    mapping(address => address) public ethOracleAddrs;
    // tokenAddr => chainlink oracle addr in usd($)
    mapping(address => address) public usdOracleAddrs;
    address internal immutable weth;

    error InvalidOraclePair();
    error InvalidAddress();
    error InvalidArrayLength();

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        bool[] memory _isEth,
        address _wethAddr
    ) {
        if (_wethAddr == address(0)) {
            revert InvalidAddress();
        }
        weth = _wethAddr;
        // if you use eth oracles with weth, will just return weth address
        ethOracleAddrs[_wethAddr] = _wethAddr;
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
        uint256 loanTokenOracleDecimals;
        uint256 collTokenOracleDecimals;
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();
        address wethAddress = weth;
        if (loanTokenOracleAddr == wethAddress) {
            answer = 10 ** 18;
            updatedAt = block.timestamp;
            loanTokenOracleDecimals = 18;
        } else {
            (, answer, , updatedAt, ) = AggregatorV3Interface(
                loanTokenOracleAddr
            ).latestRoundData();
            loanTokenOracleDecimals = AggregatorV3Interface(loanTokenOracleAddr)
                .decimals();
        }
        // todo: decide on logic check for updatedAt versus current timestamp?
        uint256 loanTokenPriceRaw = uint256(answer);
        if (loanTokenPriceRaw < 1) {
            revert();
        }
        if (collTokenOracleAddr == wethAddress) {
            answer = 10 ** 18;
            updatedAt = block.timestamp;
            collTokenOracleDecimals = 18;
        } else {
            (, answer, , updatedAt, ) = AggregatorV3Interface(
                collTokenOracleAddr
            ).latestRoundData();
            collTokenOracleDecimals = AggregatorV3Interface(collTokenOracleAddr)
                .decimals();
        }
        // todo: decide on logic check for updatedAt versus current timestamp?
        uint256 collTokenPriceRaw = uint256(answer);
        if (collTokenPriceRaw < 1) {
            revert();
        }
        // typically loanTokenOracleDecimals should equal collTokenOracleDecimals
        collTokenPriceInLoanToken =
            (collTokenPriceRaw *
                (10 ** loanTokenDecimals) *
                (10 ** loanTokenOracleDecimals)) /
            (loanTokenPriceRaw * (10 ** collTokenOracleDecimals));
    }
}
