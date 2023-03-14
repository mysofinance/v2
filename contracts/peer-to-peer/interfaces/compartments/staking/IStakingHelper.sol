// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

interface IStakingHelper {
    /**
     * @notice Deposit `value` LP tokens, curve type take pools
     * @param value Number of tokens to deposit
     * @param depositAddr Address to deposit for
     */
    function deposit(uint256 value, address depositAddr) external;

    /**
     * @notice Withdraw `value` LP tokens, curve type take pools
     * @param value Number of tokens to withdraw
     */
    function withdraw(uint256 value) external;

    /**
     * @notice Claim all available reward tokens for msg.sender
     */
    function claim_rewards() external;

    /**
     * @notice Claim fee reward tokens
     */
    function claim(address _receiver) external returns (uint256);

    /**
     * @notice Mint allocated tokens for the caller based on a single gauge.
     * @param gaugeAddr address to get mintable amount from
     */
    function mint(address gaugeAddr) external;

    /**
     * @notice returns lpToken address for crv style gauge
     */
    function lp_token() external view returns (address);

    /**
     * @notice stakesEverything in cvx style reward pool
     */
    function stakeAll() external;

    /**
     * @notice returns lpToken address for cvx style reward pool
     */
    function staking_token() external view returns (address);

    /**
     * @notice returns reward token address for cvx reward pool
     */
    function reward_token() external view returns (address);

    /**
     * @notice returns reward token address for liquidity gauge by index
     */
    function reward_tokens(uint256 index) external view returns (address);

    function gauges(uint256 index) external view returns (address);

    function n_gauges() external view returns (int128);
}
