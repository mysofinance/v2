// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IUniV2 {
    /**
     * @notice returns reserves of uni v2 pool
     * @return token0 reserves (use unit256 to avoid overflow if uint112)
     * @return token1 reserves (use unit256 to avoid overflow if uint112)
     * @return timestamp (which isn't too relevant for us)
     */
    function getReserves() external view returns (uint256, uint256, uint32);

    /**
     * @notice token0 address of pool
     */
    function token0() external view returns (address);

    /**
     * @notice token1 address of pool
     */
    function token1() external view returns (address);

    /**
     * @notice totalSupply of the lp token
     */
    function totalSupply() external view returns (uint256);
}
