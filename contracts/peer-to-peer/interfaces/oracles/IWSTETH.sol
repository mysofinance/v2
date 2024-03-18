// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IWSTETH {
    /**
     * @notice gets amount of stEth for given wstEth
     * @param _wstETHAmount amount of wstEth
     * @return amount of stEth
     */
    function getStETHByWstETH(
        uint256 _wstETHAmount
    ) external view returns (uint256);
}
