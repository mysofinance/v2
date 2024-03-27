// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IMETH {
    /**
     * @notice gets amount of Eth for given mEth
     * @param mETHAmount amount of mEth
     * @return amount of stEth
     */
    function mETHToETH(uint256 mETHAmount) external view returns (uint256);
}
