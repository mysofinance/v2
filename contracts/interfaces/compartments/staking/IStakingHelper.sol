// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface IStakingHelper {
    /**
     * @notice Deposit `value` LP tokens, curve type take pools
     * @dev Depositing also claims pending reward tokens
     * @param value Number of tokens to deposit
     * @param depositAddr Address to deposit for
     */
    function deposit(uint256 value, address depositAddr) external;

    /**
     * @notice Withdraw `value` LP tokens, curve type take pools
     * @dev Withdrawing also claims pending reward tokens
     * @param value Number of tokens to withdraw
     */
    function withdraw(uint256 value) external;

    /**
     * @notice returns lpToken address for crv style gauge
     */
    function lp_token() external view returns (address);

    /**
     * @notice stakesEverything in cvx style rewardPool
     */
    function stakeAll() external;
}
