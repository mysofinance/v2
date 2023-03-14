// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {IOlympus} from "../../interfaces/oracles/IOlympus.sol";
import {BaseOracle} from "../BaseOracle.sol";
import {Errors} from "../../Errors.sol";

/**
 * @dev supports olympus gOhm oracles which are compatible with v2v3 or v3 interfaces
 */
contract OlympusOracle is IOracle, BaseOracle {
    address internal constant SOHM_ADDR =
        0x04906695D6D12CF5459975d7C3C03356E4Ccd460;
    address internal constant GOHM_ADDR =
        0x0ab87046fBb341D058F17CBC4c1133F25a20a52f;
    uint256 internal constant SOHM_DECIMALS = 9;
    address internal constant ETH_OHM_ORACLE_ADDR =
        0x9a72298ae3886221820B1c878d12D872087D3a23;

    // solhint-disable no-empty-blocks
    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address _wethAddr
    ) BaseOracle(_tokenAddrs, _oracleAddrs, _wethAddr, false, new bool[](0)) {}

    function getPrice(
        address collToken,
        address loanToken
    ) external view returns (uint256 collTokenPriceInLoanToken) {
        if (collToken != GOHM_ADDR && loanToken != GOHM_ADDR) {
            revert Errors.NeitherTokenIsGOHM();
        }
        (
            bool isValid,
            address loanTokenOracleAddr,
            address collTokenOracleAddr,
            bool isColl
        ) = checkValidOraclePair(collToken, loanToken);
        if (!isValid) {
            revert Errors.InvalidOraclePair();
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
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();
        address wethAddress = weth;
        if (loanTokenOracleAddr == wethAddress) {
            answer = 10 ** 18;
            updatedAt = block.timestamp;
        } else {
            (, answer, , updatedAt, ) = AggregatorV3Interface(
                loanTokenOracleAddr
            ).latestRoundData();
        }

        uint256 loanTokenPriceRaw = uint256(answer);
        if (loanTokenPriceRaw < 1) {
            revert();
        }
        if (collTokenOracleAddr == wethAddress) {
            answer = 10 ** 18;
            updatedAt = block.timestamp;
        } else {
            (, answer, , updatedAt, ) = AggregatorV3Interface(
                collTokenOracleAddr
            ).latestRoundData();
        }
        // todo: decide on logic check for updatedAt versus current timestamp?
        uint256 collTokenPriceRaw = uint256(answer);
        if (collTokenPriceRaw < 1) {
            revert();
        }
        uint256 index = IOlympus(GOHM_ADDR).index();

        collTokenPriceInLoanToken = isColl
            ? (collTokenPriceRaw * (10 ** loanTokenDecimals) * index) /
                (loanTokenPriceRaw * (10 ** SOHM_DECIMALS))
            : (collTokenPriceRaw *
                (10 ** loanTokenDecimals) *
                (10 ** SOHM_DECIMALS)) / (loanTokenPriceRaw * index);
    }
}
