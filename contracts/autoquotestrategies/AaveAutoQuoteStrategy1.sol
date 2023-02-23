// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {DataTypes} from "../DataTypes.sol";
import {IAutoQuoteStrategy} from "../interfaces/IAutoQuoteStrategy.sol";
import "hardhat/console.sol";

library AaveDataTypes {
    struct ReserveData {
        ReserveConfigurationMap configuration;
        uint128 liquidityIndex;
        uint128 variableBorrowIndex;
        uint128 currentLiquidityRate;
        uint128 currentVariableBorrowRate;
        uint128 currentStableBorrowRate;
        uint40 lastUpdateTimestamp;
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
        address interestRateStrategyAddress;
        uint8 id;
    }

    struct ReserveConfigurationMap {
        uint256 data;
    }
}

interface ILendingPool {
    function getReserveData(
        address asset
    ) external view returns (AaveDataTypes.ReserveData memory);
}

interface ILendingPoolAddressesProvider {
    function getPriceOracle() external view returns (address);
}

interface IPriceOracleGetter {
    function getAssetPrice(address _asset) external view returns (uint256);
}

contract AaveAutoQuoteStrategy1 is IAutoQuoteStrategy {
    address constant AAVE_V2_LENDING_POOL_ADDR =
        0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9;
    address constant AAVE_V2_LENDING_POOL_ADDRS_PROVIDER =
        0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5;
    uint256 constant RAY = 1e27;
    uint256 constant BASE = 1e18;
    uint256 constant TARGET_LTV = (BASE * 50) / 100;
    address constant COLL_TOKEN = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant LOAN_TOKEN = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    function getQuote() external view returns (DataTypes.Quote memory quote) {
        /*
        quote.collToken = COLL_TOKEN;
        quote.loanToken = LOAN_TOKEN;

        // rates in RAY: https://docs.aave.com/developers/v/1.0/developing-on-aave/important-considerations#ray-math
        uint256 aaveFixedRate = ILendingPool(AAVE_V2_LENDING_POOL_ADDR)
            .getReserveData(quote.loanToken)
            .currentStableBorrowRate;
        address oracle = ILendingPoolAddressesProvider(
            AAVE_V2_LENDING_POOL_ADDRS_PROVIDER
        ).getPriceOracle();
        uint256 loanTokenPrice = IPriceOracleGetter(oracle).getAssetPrice(
            quote.loanToken
        );
        uint256 collTokenPrice = IPriceOracleGetter(oracle).getAssetPrice(
            quote.collToken
        );

        uint256 collPriceDenomInLoanCcy = (collTokenPrice *
            10 ** IERC20Metadata(quote.loanToken).decimals()) /
            loanTokenPrice;
        quote.quoteTuples.loanPerCollUnitOrLtv[0] =
            (collPriceDenomInLoanCcy * TARGET_LTV) /
            BASE;
        quote.quoteTuples.upfrontFeePctInBase[0] = 0;
        quote.quoteTuples.tenor[0] = 60 * 60 * 24 * 30;
        quote.quoteTuples.interestRatePctInBase[0] =
            (aaveFixedRate * BASE * quote.quoteTuples.tenor[0]) /
            (24 * 60 * 60 * 365) /
            RAY;
        quote.quoteTuples.earliestRepayTenor = 0;
        quote.quoteTuples.isNegativeInterestRate = false;
        quote.borrowerCompartmentImplementation = address(0);
        */
    }
}
