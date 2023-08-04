// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../DataTypesPeerToPeer.sol";

interface IQuotePolicyManager {
    event PolicyDeleted(
        address indexed lenderVault,
        address indexed collToken,
        address indexed loanToken
    );

    event DefaultPolicySet(
        address indexed lenderVault,
        DataTypesPeerToPeer.DefaultPolicyState defaultPolicyState
    );

    /**
     * @notice deletes the policy for a pair of tokens
     * @param lenderVault Address of the lender vault
     * @param collToken Address of the collateral token
     * @param loanToken Address of the loan token
     */
    function deletePolicyForPair(
        address lenderVault,
        address collToken,
        address loanToken
    ) external;

    /**
     * @notice sets the default policy for a vault
     * this state will control access whenever a policy is not set for a pair of tokens
     * @param lenderVault Address of the lender vault
     * @param defaultPolicyState Default policy state to be set
     */
    function setDefaultPolicy(
        address lenderVault,
        DataTypesPeerToPeer.DefaultPolicyState defaultPolicyState
    ) external;

    /**
     * @notice Checks if a borrow violates the policy set by the lender
     * this function should always return 0 for _minSignersForThisPolicy if the policy is not set
     * @param borrower Address of the borrower
     * @param lenderVault Address of the lender vault
     * @param generalQuoteInfo General quote info (see DataTypesPeerToPeer.sol)
     * @param quoteTuple Quote tuple (see DataTypesPeerToPeer.sol)
     * @param _isOnChainQuote Flag to indicate if the quote is on-chain or off-chain
     * @return _borrowViolatesPolicy Flag to indicate if the borrow violates the policy
     * @return _minSignersForThisPolicy Minimum number of signers required for this policy (if off-chain quote)
     */
    function borrowViolatesPolicy(
        address borrower,
        address lenderVault,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple,
        bool _isOnChainQuote
    )
        external
        view
        returns (bool _borrowViolatesPolicy, uint256 _minSignersForThisPolicy);

    /**
     * @notice Gets the default policy state when no policy is set for a vault
     * @param lenderVault Address of the lender vault
     */
    function defaultRulesWhenNoPolicySet(
        address lenderVault
    )
        external
        view
        returns (DataTypesPeerToPeer.DefaultPolicyState defaultPolicyState);

    /**
     * @notice Gets the address registry
     * @return Address of the address registry
     */
    function addressRegistry() external view returns (address);
}
