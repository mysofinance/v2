// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {BaseOracle} from "../BaseOracle.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports oracles which are compatible with v2v3 or v3 interfaces
 */
contract ChainlinkBasic is BaseOracle, IOracle {
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
        validBtcCheck(loanToken, collToken);
        (
            bool isValid,
            address loanTokenOracleAddr,
            address collTokenOracleAddr
        ) = checkValidOraclePair(collToken, loanToken);
        if (!isValid) {
            revert Errors.InvalidOraclePair();
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
        // try to see if both have non-zero oracleAddrs
        loanTokenOracleAddr = oracleAddrs[loanToken];
        collTokenOracleAddr = oracleAddrs[collToken];
        isValid =
            loanTokenOracleAddr != address(0) &&
            collTokenOracleAddr != address(0);
    }

    function calculatePrice(
        address loanTokenOracleAddr,
        address collTokenOracleAddr,
        address loanToken
    ) internal view returns (uint256 collTokenPriceInLoanToken) {
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();
        uint256 loanTokenPriceRaw = getPriceOfToken(loanTokenOracleAddr);
        uint256 collTokenPriceRaw = getPriceOfToken(collTokenOracleAddr);
        collTokenPriceInLoanToken =
            (collTokenPriceRaw * (10 ** loanTokenDecimals)) /
            (loanTokenPriceRaw);
    }
}
