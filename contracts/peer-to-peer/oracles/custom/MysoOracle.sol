// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ChainlinkBase} from "../chainlink/ChainlinkBase.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IWSTETH} from "../../interfaces/oracles/IWSTETH.sol";
import {IMETH} from "../../interfaces/oracles/IMETH.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @dev supports oracles which are compatible with v2v3 or v3 interfaces
 */
contract MysoOracle is ChainlinkBase, Ownable {
    struct MysoPrice {
        uint112 prePrice;
        uint112 postPrice;
        uint32 switchTime;
    }

    // solhint-disable var-name-mixedcase
    address internal constant MYSO = 0x00000000000000000000000000000000DeaDBeef; // TODO: put in real myso address
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant WSTETH =
        0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address internal constant METH = 0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa;
    address internal constant RPL = 0xD33526068D116cE69F19A9ee46F0bd304F21A51f;
    address internal constant METH_STAKING_CONTRACT =
        0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f;
    uint256 internal constant MYSO_IOO_BASE_CURRENCY_UNIT = 1e18; // 18 decimals for ETH based oracles
    address internal constant ETH_USD_CHAINLINK =
        0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
    address internal constant STETH_ETH_CHAINLINK =
        0x86392dC19c0b719886221c78AB11eb8Cf5c52812;
    address internal constant RPL_USD_CHAINLINK =
        0x4E155eD98aFE9034b7A5962f6C84c86d869daA9d;

    uint256 internal constant MYSO_PRICE_TIME_LOCK = 5 minutes;

    MysoPrice public mysoPrice;
    //address public owner;

    event MysoPriceUpdated(
        uint112 prePrice,
        uint112 postPrice,
        uint32 switchTime
    );

    error NoMyso();

    /**
     * @dev constructor for MysoOracle
     * @param _tokenAddrs array of token addresses
     * @param _oracleAddrs array of oracle addresses
     * @param _mysoUsdPrice initial price of myso in usd (use 8 decimals like chainlink) (eg. 0.50 USD = 0.5 * 1e8)
     */
    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        uint112 _mysoUsdPrice,
        address _owner
    )
        ChainlinkBase(_tokenAddrs, _oracleAddrs, MYSO_IOO_BASE_CURRENCY_UNIT)
        Ownable()
    {
        mysoPrice = MysoPrice(
            _mysoUsdPrice,
            _mysoUsdPrice,
            uint32(block.timestamp)
        );
        _transferOwnership(_owner);
    }

    /**
     * @dev updates postPrice and switchTime
     * only updates prePrice if the switchTime has passed
     * @param _newMysoUsdPrice initial price of myso in usd (use 8 decimals like chainlink) (eg. 0.50 USD = 0.5 * 1e8)
     */

    function setMysoPrice(uint112 _newMysoUsdPrice) external onlyOwner {
        MysoPrice memory currMysoPrice = mysoPrice;
        uint32 newTimeStamp = uint32(block.timestamp + MYSO_PRICE_TIME_LOCK);
        // if the switchTime has not yet passed, update only postPrice with new price,
        // leave prePrice the same and update switchTime
        // else if the switchTime has passed (or exactly equal), update the prePrice with postPrice,
        // update the postPrice with new price, and update switchTime
        uint112 prePrice = block.timestamp < currMysoPrice.switchTime
            ? currMysoPrice.prePrice
            : mysoPrice.postPrice;
        mysoPrice = MysoPrice(prePrice, _newMysoUsdPrice, newTimeStamp);
        emit MysoPriceUpdated(prePrice, _newMysoUsdPrice, newTimeStamp);
    }

    function getPrice(
        address collToken,
        address loanToken
    ) external view override returns (uint256 collTokenPriceInLoanToken) {
        (uint256 priceOfCollToken, uint256 priceOfLoanToken) = getRawPrices(
            collToken,
            loanToken
        );
        uint256 loanTokenDecimals = (loanToken == MYSO)
            ? 18
            : IERC20Metadata(loanToken).decimals();
        collTokenPriceInLoanToken =
            (priceOfCollToken * 10 ** loanTokenDecimals) /
            priceOfLoanToken;
    }

    function getRawPrices(
        address collToken,
        address loanToken
    )
        public
        view
        override
        returns (uint256 collTokenPriceRaw, uint256 loanTokenPriceRaw)
    {
        // must have at least one token is MYSO to use this oracle
        if (collToken != MYSO && loanToken != MYSO) {
            revert NoMyso();
        }
        (collTokenPriceRaw, loanTokenPriceRaw) = (
            _getPriceOfToken(collToken),
            _getPriceOfToken(loanToken)
        );
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
        } else if (token == METH) {
            tokenPriceRaw = IMETH(METH_STAKING_CONTRACT).mETHToETH(1e18);
        } else if (token == RPL) {
            tokenPriceRaw = _getRPLPriceInEth();
        } else {
            tokenPriceRaw = super._getPriceOfToken(token);
        }
    }

    function _getWstEthPrice() internal view returns (uint256 wstEthPriceRaw) {
        uint256 stEthAmountPerWstEth = IWSTETH(WSTETH).getStETHByWstETH(1e18);
        uint256 stEthPriceInEth = _checkAndReturnLatestRoundData(
            (STETH_ETH_CHAINLINK)
        );
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
        uint256 mysoPriceInUsd = block.timestamp < mysoPrice.switchTime
            ? mysoPrice.prePrice
            : mysoPrice.postPrice;
        uint256 ethPriceInUsd = _checkAndReturnLatestRoundData(
            ETH_USD_CHAINLINK
        );
        mysoPriceInEth = Math.mulDiv(mysoPriceInUsd, 1e18, ethPriceInUsd);
    }

    function _getRPLPriceInEth() internal view returns (uint256 rplPriceRaw) {
        uint256 rplPriceInUSD = _checkAndReturnLatestRoundData(
            (RPL_USD_CHAINLINK)
        );
        uint256 ethPriceInUsd = _checkAndReturnLatestRoundData(
            ETH_USD_CHAINLINK
        );
        rplPriceRaw = Math.mulDiv(rplPriceInUSD, 1e18, ethPriceInUsd);
    }
}
