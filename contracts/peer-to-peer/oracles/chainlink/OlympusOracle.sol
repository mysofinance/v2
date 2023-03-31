// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {IOlympus} from "../../interfaces/oracles/IOlympus.sol";
import {BaseOracle} from "../BaseOracle.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports olympus gOhm oracles which are compatible with v2v3 or v3 interfaces
 * should only be utilized with eth based oracles, not usd-based oracles
 */
contract OlympusOracle is IOracle, BaseOracle {
    address internal constant GOHM_ADDR =
        0x0ab87046fBb341D058F17CBC4c1133F25a20a52f;
    uint256 internal constant SOHM_DECIMALS = 9;
    address internal constant ETH_OHM_ORACLE_ADDR =
        0x9a72298ae3886221820B1c878d12D872087D3a23;

    // solhint-disable no-empty-blocks
    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address _wethAddrOfGivenChain,
        address _wBTCAddrOfGivenChain,
        address _btcToUSDOracleAddrOfGivenChain,
        address _wBTCToBTCOracleAddrOfGivenChain
    )
        BaseOracle(
            _tokenAddrs,
            _oracleAddrs,
            _wethAddrOfGivenChain,
            _wBTCAddrOfGivenChain,
            _btcToUSDOracleAddrOfGivenChain,
            _wBTCToBTCOracleAddrOfGivenChain
        )
    {}

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
        // try to see if both have non-zero oracleAddrs
        if (collToken == GOHM_ADDR) {
            loanTokenOracleAddr = oracleAddrs[loanToken];
            collTokenOracleAddr = ETH_OHM_ORACLE_ADDR;
            isColl = true;
        } else {
            loanTokenOracleAddr = ETH_OHM_ORACLE_ADDR;
            collTokenOracleAddr = oracleAddrs[collToken];
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
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();
        uint256 loanTokenPriceRaw = getPriceOfToken(loanTokenOracleAddr);
        uint256 collTokenPriceRaw = getPriceOfToken(collTokenOracleAddr);
        uint256 index = IOlympus(GOHM_ADDR).index();

        collTokenPriceInLoanToken = isColl
            ? (collTokenPriceRaw * (10 ** loanTokenDecimals) * index) /
                (loanTokenPriceRaw * (10 ** SOHM_DECIMALS))
            : (collTokenPriceRaw *
                (10 ** loanTokenDecimals) *
                (10 ** SOHM_DECIMALS)) / (loanTokenPriceRaw * index);
    }
}
