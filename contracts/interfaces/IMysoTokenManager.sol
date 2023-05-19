// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../peer-to-peer/DataTypesPeerToPeer.sol";
import {DataTypesPeerToPool} from "../peer-to-pool/DataTypesPeerToPool.sol";

interface IMysoTokenManager {
    function processP2PBorrow(
        uint256 currProtocolFee,
        DataTypesPeerToPeer.BorrowTransferInstructions
            calldata borrowInstructions,
        DataTypesPeerToPeer.Loan calldata loan,
        address lenderVault
    ) external returns (uint256 applicableProtocolFee);

    function processP2PCreateVault(
        uint256 numRegisteredVaults,
        address vaultCreator,
        address newLenderVaultAddr
    ) external;

    function processP2PoolDeposit(
        address fundingPool,
        address depositor,
        uint256 depositAmount,
        uint256 transferFee
    ) external;

    function processP2PoolSubscribe(
        address fundingPool,
        address subscriber,
        address loanProposal,
        uint256 subscriptionAmount,
        uint256 totalSubscriptions,
        DataTypesPeerToPool.LoanTerms calldata loanTerms
    ) external;
}
