// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../DataTypesPeerToPeer.sol";

interface IQuotePolicyManager {
    function checkPendingBorrowQuoteInfoAndTuple(
        address borrower,
        address lenderVault,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple,
        bool onChainQuote
    ) external view returns (bool isValid);

    function checkNewOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) external view returns (bool isValid);
}
