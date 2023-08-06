// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../DataTypesPeerToPeer.sol";

interface IQuotePolicyManager {
    event PolicySet(
        address indexed lenderVault,
        address indexed collToken,
        address indexed loanToken,
        bytes policyData
    );
    event PolicyDeleted(
        address indexed lenderVault,
        address indexed collToken,
        address indexed loanToken
    );

    /**
     * @notice sets the policy for a pair of tokens
     * @param lenderVault Address of the lender vault
     * @param collToken Address of the collateral token
     * @param loanToken Address of the loan token
     * @param policyData Policy data to be set
     */
    function setAllowedPairAndPolicy(
        address lenderVault,
        address collToken,
        address loanToken,
        bytes calldata policyData
    ) external;

    /**
     * @notice deletes the policy for a pair of tokens
     * @param lenderVault Address of the lender vault
     * @param collToken Address of the collateral token
     * @param loanToken Address of the loan token
     */
    function deleteAllowedPairAndPolicy(
        address lenderVault,
        address collToken,
        address loanToken
    ) external;

    /**
     * @notice Checks if a borrow is allowed
     * @param borrower Address of the borrower
     * @param lenderVault Address of the lender vault
     * @param generalQuoteInfo General quote info (see DataTypesPeerToPeer.sol)
     * @param quoteTuple Quote tuple (see DataTypesPeerToPeer.sol)
     * @return _isAllowed Flag to indicate if the borrow is allowed
     */
    function isAllowed(
        address borrower,
        address lenderVault,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    ) external view returns (bool _isAllowed);

    /**
     * @notice Gets the address registry
     * @return Address of the address registry
     */
    function addressRegistry() external view returns (address);
}
