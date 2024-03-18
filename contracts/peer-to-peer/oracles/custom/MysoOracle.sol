// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ChainlinkBase} from "../chainlink/ChainlinkBase.sol";
import {Errors} from "../../../Errors.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IWSTETH} from "../../interfaces/oracles/IWSTETH.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @dev supports oracles which are compatible with v2v3 or v3 interfaces
 */
contract MysoOracle is ChainlinkBase, Ownable2Step {
    struct MysoPrice {
        uint112 priceUntilTimestampPassed;
        uint112 priceOnceTimestampPassed;
        uint32 timestampLatestProposedPriceBecomesValid;
    }

    // solhint-disable var-name-mixedcase
    address internal constant MYSO = 0x00000000000000000000000000000000DeaDBeef; // TODO: put in real myso address
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; // weth
    address internal constant WSTETH =
        0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0; //wsteth
    address internal constant STETH =
        0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84; //steth
    uint256 internal constant MYSO_IOO_BASE_CURRENCY_UNIT = 1e18; // 18 decimals for ETH based oracles
    address internal constant ETH_USD_CHAINLINK =
        0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419; //eth usd chainlink

    uint256 internal constant MYSO_PRICE_TIME_LOCK = 1 days;

    MysoPrice public mysoPrice;

    /**
     * @dev constructor for MysoOracle
     * @param _tokenAddrs array of token addresses
     * @param _oracleAddrs array of oracle addresses
     * @param _mysoUsdPrice initial price of myso in usd (use 8 decimals like chainlink) (eg. 0.50 USD = 0.5 * 1e8)
     */
    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        uint112 _mysoUsdPrice
    ) ChainlinkBase(_tokenAddrs, _oracleAddrs, MYSO_IOO_BASE_CURRENCY_UNIT) {
        mysoPrice = MysoPrice(
            _mysoUsdPrice,
            _mysoUsdPrice,
            uint32(block.timestamp)
        );
    }

    /**
     * @dev updates timestampLatestProposedPriceBecomesValid and priceOnceTimestampPassed
     * only updates priceUntilTimestampPassed if the prior time lock had passed
     * @param _newMysoUsdPrice initial price of myso in usd (use 8 decimals like chainlink) (eg. 0.50 USD = 0.5 * 1e8)
     */

    function setMysoPrice(uint112 _newMysoUsdPrice) external onlyOwner {
        if (
            block.timestamp < mysoPrice.timestampLatestProposedPriceBecomesValid
        ) {
            // if the priceOnceTimestampPassed is not yet active, update that price,
            // leave priceUntilTimestampPassed the same but reset the time lock
            mysoPrice = MysoPrice(
                mysoPrice.priceUntilTimestampPassed,
                _newMysoUsdPrice,
                uint32(block.timestamp + MYSO_PRICE_TIME_LOCK)
            );
        } else {
            // if the priceOnceTimestampPassed is not yet active, update the priceUntilTimestampPassed with old priceOnceTimestampPassed,
            // update the priceOnceTimestampPassed with new price, and reset the time lock
            mysoPrice = MysoPrice(
                mysoPrice.priceOnceTimestampPassed,
                _newMysoUsdPrice,
                uint32(block.timestamp + MYSO_PRICE_TIME_LOCK)
            );
        }
    }

    function _getPriceOfToken(
        address token
    ) internal view virtual override returns (uint256 tokenPriceRaw) {
        if (token == MYSO) {
            tokenPriceRaw = _getMysoPriceInEth();
        } else if (token == WETH) {
            tokenPriceRaw = 1e18;
        } else if (token == WSTETH) {
            tokenPriceRaw = _getWstEthPrice();
        } else {
            tokenPriceRaw = super._getPriceOfToken(token);
        }
    }

    function _getWstEthPrice() internal view returns (uint256 wstEthPriceRaw) {
        uint256 stEthAmountPerWstEth = IWSTETH(WSTETH).getStETHByWstETH(1e18);
        uint256 stEthPriceInEth = _getPriceOfToken(STETH);
        wstEthPriceRaw = Math.mulDiv(
            stEthPriceInEth,
            stEthAmountPerWstEth,
            1e18
        );
    }

    function _getMysoPriceInEth()
        internal
        view
        returns (uint256 mysoPriceInEth)
    {
        uint256 mysoPriceInUsd = block.timestamp <
            mysoPrice.timestampLatestProposedPriceBecomesValid
            ? mysoPrice.priceUntilTimestampPassed
            : mysoPrice.priceOnceTimestampPassed;
        uint256 ethPriceInUsd = _checkAndReturnLatestRoundData(
            ETH_USD_CHAINLINK
        );
        mysoPriceInEth = Math.mulDiv(mysoPriceInUsd, 1e18, ethPriceInUsd);
    }
}
