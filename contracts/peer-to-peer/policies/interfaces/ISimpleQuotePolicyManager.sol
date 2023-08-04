// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../DataTypesPeerToPeer.sol";

interface ISimpleQuotePolicyManager {
    event PolicySet(
        address indexed lenderVault,
        address indexed collToken,
        address indexed loanToken,
        DataTypesPeerToPeer.SimplePolicy policy
    );

    /**
     * @notice sets the policy for a pair of tokens
     * @param lenderVault Address of the lender vault
     * @param collToken Address of the collateral token
     * @param loanToken Address of the loan token
     * @param policy Policy to be set
     */
    function setPolicyForPair(
        address lenderVault,
        address collToken,
        address loanToken,
        DataTypesPeerToPeer.SimplePolicy calldata policy
    ) external;
}
