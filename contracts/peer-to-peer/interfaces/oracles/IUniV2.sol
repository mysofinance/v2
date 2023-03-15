// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IUniV2 {
    /**
     * @notice returns reserves of uni v2 pool
     * @return _ token0 reserves
     * @return _ token1 reserves
     * @return _ timestamp (which isn't too relevant for us)
     */
    function getReserves() external view returns (uint112, uint112, uint32);

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
