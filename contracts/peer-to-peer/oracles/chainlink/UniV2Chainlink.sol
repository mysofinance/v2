// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {IUniV2} from "../../interfaces/oracles/IUniV2.sol";
import {BaseOracle} from "../BaseOracle.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports oracles which have one token which is a 50/50 LP token
 * compatible with v2v3 or v3 interfaces
 * should only be utilized with eth based oracles, not usd-based oracles
 */
contract UniV2Chainlink is IOracle, BaseOracle {
    struct OracleData {
        address token0;
        address token1;
        address oracleAddrToken0;
        address oracleAddrToken1;
    }

    mapping(address => bool) public isLpAddr;

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address[] memory _lpAddrs,
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
    {
        if (_wethAddrOfGivenChain == address(0)) {
            revert Errors.InvalidAddress();
        }
        if (_lpAddrs.length == 0) {
            revert Errors.InvalidArrayLength();
        }
        for (uint i = 0; i < _lpAddrs.length; ) {
            if (_lpAddrs[i] == address(0)) {
                revert Errors.InvalidAddress();
            }
            isLpAddr[_lpAddrs[i]] = true;
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
            OracleData memory loanTokenOracleData,
            OracleData memory collTokenOracleData
        ) = checkValidOraclePair(collToken, loanToken);
        collTokenPriceInLoanToken = calculatePrice(
            loanTokenOracleData,
            collTokenOracleData,
            loanToken,
            collToken
        );
    }

    function checkValidOraclePair(
        address collToken,
        address loanToken
    )
        internal
        view
        returns (
            OracleData memory loanTokenOracleData,
            OracleData memory collTokenOracleData
        )
    {
        if (!isLpAddr[collToken] && !isLpAddr[loanToken]) {
            revert Errors.NoLpTokens();
        }
        address _token0;
        address _token1;
        if (isLpAddr[loanToken]) {
            _token0 = IUniV2(loanToken).token0();
            _token1 = IUniV2(loanToken).token1();
            // check oracles exist for both
            if (
                oracleAddrs[_token0] == address(0) ||
                oracleAddrs[_token1] == address(0)
            ) {
                revert Errors.InvalidOraclePair();
            }
            loanTokenOracleData = OracleData({
                token0: _token0,
                token1: _token1,
                oracleAddrToken0: oracleAddrs[_token0],
                oracleAddrToken1: oracleAddrs[_token1]
            });
        } else {
            if (oracleAddrs[loanToken] == address(0)) {
                revert Errors.InvalidOraclePair();
            }
            loanTokenOracleData = OracleData({
                token0: loanToken,
                token1: address(0),
                oracleAddrToken0: oracleAddrs[loanToken],
                oracleAddrToken1: address(0)
            });
        }
        if (isLpAddr[collToken]) {
            _token0 = IUniV2(collToken).token0();
            _token1 = IUniV2(collToken).token1();
            // check oracles exist for both
            if (
                oracleAddrs[_token0] == address(0) ||
                oracleAddrs[_token1] == address(0)
            ) {
                revert Errors.InvalidOraclePair();
            }
            collTokenOracleData = OracleData({
                token0: _token0,
                token1: _token1,
                oracleAddrToken0: oracleAddrs[_token0],
                oracleAddrToken1: oracleAddrs[_token1]
            });
        } else {
            if (oracleAddrs[collToken] == address(0)) {
                revert Errors.InvalidOraclePair();
            }
            collTokenOracleData = OracleData({
                token0: collToken,
                token1: address(0),
                oracleAddrToken0: oracleAddrs[collToken],
                oracleAddrToken1: address(0)
            });
        }
    }

    function calculatePrice(
        OracleData memory loanTokenOracleData,
        OracleData memory collTokenOracleData,
        address loanToken,
        address collToken
    ) internal view returns (uint256 collTokenPriceInLoanToken) {
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();
        uint256 loanTokenPriceRaw;
        uint256 collTokenPriceRaw;
        // if token1 is address 0 means loan token was not an lp token
        if (loanTokenOracleData.token1 == address(0)) {
            loanTokenPriceRaw = getPriceOfToken(
                loanTokenOracleData.oracleAddrToken0
            );
        } else {
            // loan token was an Lp token
            loanTokenPriceRaw = getLpTokenPrice(
                loanTokenOracleData,
                loanToken,
                false
            );
        }

        // if token1 is address 0 means coll token was not an lp token
        if (collTokenOracleData.token1 == address(0)) {
            collTokenPriceRaw = getPriceOfToken(
                collTokenOracleData.oracleAddrToken0
            );
        } else {
            // coll token was an Lp token
            collTokenPriceRaw = getLpTokenPrice(
                collTokenOracleData,
                collToken,
                true
            );
        }

        collTokenPriceInLoanToken =
            (collTokenPriceRaw * (10 ** loanTokenDecimals)) /
            (loanTokenPriceRaw);
    }

    function getLpTokenPrice(
        OracleData memory lpTokenOracleData,
        address lpTokenAddr,
        bool isColl
    ) internal view returns (uint256 lpTokenPriceInEth) {
        uint256 unsignedLpTokenPriceInEth = getTotalEthValue(
            lpTokenOracleData,
            lpTokenAddr,
            isColl
        );
        uint256 lpTokenDecimals = IERC20Metadata(lpTokenAddr).decimals();
        uint256 totalLpSupply = IUniV2(lpTokenAddr).totalSupply();
        lpTokenPriceInEth =
            (unsignedLpTokenPriceInEth * (10 ** lpTokenDecimals)) /
            totalLpSupply;
        if (lpTokenPriceInEth < 1) {
            revert Errors.InvalidOracleAnswer();
        }
    }

    function getTotalEthValue(
        OracleData memory lpTokenOracleData,
        address lpTokenAddr,
        bool isColl
    ) internal view returns (uint256 ethValueBounded) {
        address token0 = lpTokenOracleData.token0;
        address token1 = lpTokenOracleData.token1;
        (uint112 reserve0, uint112 reserve1, ) = IUniV2(lpTokenAddr)
            .getReserves();
        uint256 decimalsToken0 = IERC20Metadata(token0).decimals();
        uint256 decimalsToken1 = IERC20Metadata(token1).decimals();
        uint256 token0PriceRaw = getPriceOfToken(
            lpTokenOracleData.oracleAddrToken0
        );
        uint256 token1PriceRaw = getPriceOfToken(
            lpTokenOracleData.oracleAddrToken1
        );

        uint256 totalEthValueToken0 = (uint256(reserve0) * token0PriceRaw) /
            (10 ** decimalsToken0);
        uint256 totalEthValueToken1 = (uint256(reserve1) * token1PriceRaw) /
            (10 ** decimalsToken1);

        if (isColl) {
            // for collateral LP tokens use the lower bound (since coll token in numerator)
            ethValueBounded = totalEthValueToken0 > totalEthValueToken1
                ? totalEthValueToken1 * 2
                : totalEthValueToken0 * 2;
        } else {
            // for loan LP tokens use the upper bound (since loan token is in denominator)
            ethValueBounded = totalEthValueToken0 > totalEthValueToken1
                ? totalEthValueToken0 * 2
                : totalEthValueToken1 * 2;
        }
    }
}
