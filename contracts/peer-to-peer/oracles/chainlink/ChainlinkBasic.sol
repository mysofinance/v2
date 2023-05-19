// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {Constants} from "../../../Constants.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports oracles which are compatible with v2v3 or v3 interfaces
 */
contract ChainlinkBasic is IOracle {
    // solhint-disable no-empty-blocks

    address public immutable BASE_CURRENCY;
    uint256 public immutable BASE_CURRENCY_UNIT;
    uint256 public immutable underCollateralizationFactor;
    mapping(address => address) public oracleAddrs;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address baseCurrency,
        uint256 baseCurrencyUnit,
        uint256 _underCollateralizationFactor
    ) {
        if (
            _tokenAddrs.length == 0 || _tokenAddrs.length != _oracleAddrs.length
        ) {
            revert Errors.InvalidArrayLength();
        }
        if (
            _underCollateralizationFactor == 0 ||
            _underCollateralizationFactor >
            Constants.MAX_ORACLE_COLLATERALIZATION_FACTOR
        ) {
            revert Errors.InvalidUnderCollateralizationFactor();
        }
        uint8 oracleDecimals;
        uint256 version;
        for (uint i = 0; i < _oracleAddrs.length; ) {
            if (_tokenAddrs[i] == address(0) || _oracleAddrs[i] == address(0)) {
                revert Errors.InvalidAddress();
            }
            oracleDecimals = AggregatorV3Interface(_oracleAddrs[i]).decimals();
            if (10 ** oracleDecimals != baseCurrencyUnit) {
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
        BASE_CURRENCY = baseCurrency;
        BASE_CURRENCY_UNIT = baseCurrencyUnit;
        underCollateralizationFactor = _underCollateralizationFactor;
    }

    function getPrice(
        address collToken,
        address loanToken
    ) external view virtual returns (uint256 collTokenPriceInLoanToken) {
        uint256 priceOfCollToken = getPriceOfToken(collToken);
        uint256 priceOfLoanToken = getPriceOfToken(loanToken);
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();
        collTokenPriceInLoanToken =
            (underCollateralizationFactor *
                priceOfCollToken *
                10 ** loanTokenDecimals) /
            priceOfLoanToken;
    }

    function getPriceOfToken(
        address token
    ) internal view virtual returns (uint256 tokenPriceRaw) {
        if (token == BASE_CURRENCY) {
            tokenPriceRaw = BASE_CURRENCY_UNIT;
        } else {
            address oracleAddr = oracleAddrs[token];
            if (oracleAddr == address(0)) {
                revert Errors.NoOracle();
            }
            tokenPriceRaw = checkAndReturnLatestRoundData(oracleAddr);
        }
    }

    function checkAndReturnLatestRoundData(
        address oracleAddr
    ) internal view returns (uint256 tokenPriceRaw) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = AggregatorV3Interface(oracleAddr).latestRoundData();
        if (
            roundId == 0 ||
            answeredInRound < roundId ||
            answer < 1 ||
            updatedAt == 0 ||
            updatedAt > block.timestamp
        ) {
            revert Errors.InvalidOracleAnswer();
        }
        tokenPriceRaw = uint256(answer);
    }
}
