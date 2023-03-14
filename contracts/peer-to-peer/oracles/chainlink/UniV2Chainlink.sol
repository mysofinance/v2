// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../interfaces/oracles/chainlink/AggregatorV3Interface.sol";
import {IOracle} from "../../interfaces/IOracle.sol";
import {IUniV2} from "../../interfaces/oracles/IUniV2.sol";
import {BaseOracle} from "../BaseOracle.sol";
import {Errors} from "../../../Errors.sol";

/**
 * @dev supports oracles which have one token which is a 50/50 LP token
 * compatible with v2v3 or v3 interfaces
 */
contract UniV2Chainlink is IOracle, BaseOracle {
    mapping(address => bool) public isLpAddr;

    struct OracleData {
        address token0;
        address token1;
        address oracleAddrToken0;
        address oracleAddrToken1;
    }

    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address[] memory _lpAddrs,
        address _wethAddr
    ) BaseOracle(_tokenAddrs, _oracleAddrs, _wethAddr, false, new bool[](0)) {
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
            // check eth oracles exist for both
            if (
                ethOracleAddrs[_token0] == address(0) ||
                ethOracleAddrs[_token1] == address(0)
            ) {
                revert Errors.InvalidOraclePair();
            }
            loanTokenOracleData = OracleData({
                token0: _token0,
                token1: _token1,
                oracleAddrToken0: ethOracleAddrs[_token0],
                oracleAddrToken1: ethOracleAddrs[_token1]
            });
        } else {
            if (ethOracleAddrs[loanToken] == address(0)) {
                revert Errors.InvalidOraclePair();
            }
            loanTokenOracleData = OracleData({
                token0: loanToken,
                token1: address(0),
                oracleAddrToken0: ethOracleAddrs[loanToken],
                oracleAddrToken1: address(0)
            });
        }
        if (isLpAddr[collToken]) {
            _token0 = IUniV2(collToken).token0();
            _token1 = IUniV2(collToken).token1();
            // check eth oracles exist for both
            if (
                ethOracleAddrs[_token0] == address(0) ||
                ethOracleAddrs[_token1] == address(0)
            ) {
                revert Errors.InvalidOraclePair();
            }
            collTokenOracleData = OracleData({
                token0: _token0,
                token1: _token1,
                oracleAddrToken0: ethOracleAddrs[_token0],
                oracleAddrToken1: ethOracleAddrs[_token1]
            });
        } else {
            if (ethOracleAddrs[collToken] == address(0)) {
                revert Errors.InvalidOraclePair();
            }
            collTokenOracleData = OracleData({
                token0: collToken,
                token1: address(0),
                oracleAddrToken0: ethOracleAddrs[collToken],
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
        int256 answer;
        uint256 updatedAt;
        uint256 loanTokenDecimals = IERC20Metadata(loanToken).decimals();
        address wethAddress = weth;
        // if token1 is address 0 means loan token was not an lp token
        if (loanTokenOracleData.token1 == address(0)) {
            if (loanTokenOracleData.token0 == wethAddress) {
                answer = 10 ** 18;
                updatedAt = block.timestamp;
            } else {
                (, answer, , updatedAt, ) = AggregatorV3Interface(
                    loanTokenOracleData.oracleAddrToken0
                ).latestRoundData();
            }
        } else {
            // loan token was an Lp token
            answer = getLpTokenPrice(loanTokenOracleData, loanToken);
            updatedAt = block.timestamp;
        }
        uint256 loanTokenPriceRaw = uint256(answer);
        if (loanTokenPriceRaw < 1) {
            revert();
        }
        // if token1 is address 0 means coll token was not an lp token
        if (collTokenOracleData.token1 == address(0)) {
            if (collTokenOracleData.token0 == wethAddress) {
                answer = 10 ** 18;
                updatedAt = block.timestamp;
            } else {
                (, answer, , updatedAt, ) = AggregatorV3Interface(
                    collTokenOracleData.oracleAddrToken0
                ).latestRoundData();
            }
        } else {
            // coll token was an Lp token
            answer = getLpTokenPrice(collTokenOracleData, collToken);
            updatedAt = block.timestamp;
        }
        uint256 collTokenPriceRaw = uint256(answer);
        if (collTokenPriceRaw < 1) {
            revert();
        }

        collTokenPriceInLoanToken =
            (collTokenPriceRaw * (10 ** loanTokenDecimals)) /
            (loanTokenPriceRaw);
    }

    function getLpTokenPrice(
        OracleData memory lpTokenOracleData,
        address lpTokenAddr
    ) internal view returns (int256 lpTokenPriceInEth) {
        uint256 unsignedLpTokenPriceInEth = getTotalEthValue(
            lpTokenOracleData,
            lpTokenAddr
        );
        uint256 lpTokenDecimals = IERC20Metadata(lpTokenAddr).decimals();
        uint256 totalLpSupply = IUniV2(lpTokenAddr).totalSupply();
        lpTokenPriceInEth = int256(
            (unsignedLpTokenPriceInEth * (10 ** lpTokenDecimals)) /
                totalLpSupply
        );
    }

    function getTotalEthValue(
        OracleData memory lpTokenOracleData,
        address lpTokenAddr
    ) internal view returns (uint256 ethValueLowerBound) {
        address token0 = lpTokenOracleData.token0;
        address token1 = lpTokenOracleData.token1;
        (uint112 reserve0, uint112 reserve1, ) = IUniV2(lpTokenAddr)
            .getReserves();
        uint256 decimalsToken0 = IERC20Metadata(token0).decimals();
        uint256 decimalsToken1 = IERC20Metadata(token1).decimals();
        int256 answer;
        address wethAddress = weth;
        if (lpTokenOracleData.oracleAddrToken0 == wethAddress) {
            answer = 10 ** 18;
        } else {
            (, answer, , , ) = AggregatorV3Interface(
                lpTokenOracleData.oracleAddrToken0
            ).latestRoundData();
        }
        uint256 token0PriceRaw = uint256(answer);
        if (token0PriceRaw < 1) {
            revert();
        }
        if (lpTokenOracleData.oracleAddrToken1 == wethAddress) {
            answer = 10 ** 18;
        } else {
            (, answer, , , ) = AggregatorV3Interface(
                lpTokenOracleData.oracleAddrToken1
            ).latestRoundData();
        }
        uint256 token1PriceRaw = uint256(answer);
        if (token1PriceRaw < 1) {
            revert();
        }

        uint256 totalEthValueToken0 = (uint256(reserve0) * token0PriceRaw) /
            (10 ** decimalsToken0);
        uint256 totalEthValueToken1 = (uint256(reserve1) * token1PriceRaw) /
            (10 ** decimalsToken1);

        ethValueLowerBound = totalEthValueToken0 > totalEthValueToken1
            ? totalEthValueToken1 * 2
            : totalEthValueToken0 * 2;
    }
}
