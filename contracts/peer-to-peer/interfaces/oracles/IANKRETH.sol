// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IANKRETH {
    /**
     * @notice gets amount of Eth for given ankrEth
     * @param amount of ankrEth
     * @return amount of eth
     */
    function sharesToBonds(uint256 amount) external view returns (uint256);
}
