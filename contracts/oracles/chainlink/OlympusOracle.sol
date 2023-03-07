// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {IOlympus} from "../../interfaces/oracles/IOlympus.sol";

/**
 * @dev supports olympus gOhm oracles which are compatible with v2v3 or v3 interfaces
 */
contract OlympusOracle is IOracle {
    address public owner;
    address internal constant SOHM_ADDR =
        0x04906695D6D12CF5459975d7C3C03356E4Ccd460;
    address internal constant GOHM_ADDR =
        0x0ab87046fBb341D058F17CBC4c1133F25a20a52f;
    uint256 internal constant SOHM_DECIMALS = 9;
    address internal constant ETH_OHM_ORACLE_ADDR =
        0x9a72298ae3886221820B1c878d12D872087D3a23;
    // tokenAddr => chainlink oracle addr in eth
    mapping(address => address) public ethOracleAddrs;
    address internal immutable weth;

    error InvalidOraclePair();
    error InvalidAddress();
    error InvalidArrayLength();
    error NeitherTokenIsGOHM();

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address _wethAddr
    ) {
        owner = msg.sender;
        if (_wethAddr == address(0)) {
            revert InvalidAddress();
        }
        weth = _wethAddr;
        ethOracleAddrs[_wethAddr] = _wethAddr;
        if (_tokenAddrs.length != _oracleAddrs.length) {
            revert InvalidArrayLength();
        }
        for (uint i = 0; i < _oracleAddrs.length; ) {
            if (_tokenAddrs[i] == address(0) || _oracleAddrs[i] == address(0)) {
                revert InvalidAddress();
            }
            ethOracleAddrs[_tokenAddrs[i]] = _oracleAddrs[i];
            unchecked {
                ++i;
            }
        }
    }

    function getPrice(
        address collToken,
        address loanToken
    ) external view returns (uint256 collTokenPriceInLoanToken) {
        if (collToken != GOHM_ADDR && loanToken != GOHM_ADDR) {
            revert NeitherTokenIsGOHM();
        }
        (
            bool isValid,
            address loanTokenOracleAddr,
            address collTokenOracleAddr,
            bool isColl
        ) = checkValidOraclePair(collToken, loanToken);
        if (!isValid) {
            revert InvalidOraclePair();
        }
        collTokenPriceInLoanToken = calculatePrice(
            loanTokenOracleAddr,
            collTokenOracleAddr,
            loanToken,
            isColl
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
            address collTokenOracleAddr,
            bool isColl
        )
    {
        // try to see if both have non-zero ethOracleAddrs
        if (collToken == GOHM_ADDR) {
            loanTokenOracleAddr = ethOracleAddrs[loanToken];
            collTokenOracleAddr = ETH_OHM_ORACLE_ADDR;
            isColl = true;
        } else {
            loanTokenOracleAddr = ETH_OHM_ORACLE_ADDR;
            collTokenOracleAddr = ethOracleAddrs[collToken];
        }
        isValid =
            loanTokenOracleAddr != address(0) &&
            collTokenOracleAddr != address(0);
        return (isValid, loanTokenOracleAddr, collTokenOracleAddr, isColl);
    }

    function calculatePrice(
        address loanTokenOracleAddr,
        address collTokenOracleAddr,
        address loanToken,
        bool isColl
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
            // todo: decide on logic check for updatedAt versus current timestamp?
        }

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
        uint256 index = IOlympus(GOHM_ADDR).index();

        // typically loanTokenOracleDecimals should equal collTokenOracleDecimals
        collTokenPriceInLoanToken = isColl
            ? ((collTokenPriceRaw *
                (10 ** loanTokenDecimals) *
                (10 ** loanTokenOracleDecimals)) * index) /
                (loanTokenPriceRaw *
                    (10 ** collTokenOracleDecimals) *
                    (10 ** SOHM_DECIMALS))
            : ((collTokenPriceRaw *
                (10 ** loanTokenDecimals) *
                (10 ** loanTokenOracleDecimals)) * (10 ** SOHM_DECIMALS)) /
                (loanTokenPriceRaw * (10 ** collTokenOracleDecimals) * index);
    }
}
