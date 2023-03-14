// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface IEvents {
    event Received(address, uint);

    event Borrow(
        address indexed vaultAddr,
        address indexed borrower,
        DataTypes.Loan loan,
        uint256 loanId,
        address callbackAddr,
        bytes callbackData
    );

    event Repay(
        address indexed vaultAddr,
        uint256 indexed loanId,
        uint256 repayAmount
    );

    event NewProtocolFee(uint256 newFee);

    event OnChainQuoteAdded(
        address lenderVault,
        DataTypes.OnChainQuote onChainQuote,
        bytes32 onChainQuoteHash
    );

    event OnChainQuoteDeleted(address lenderVault, bytes32 onChainQuoteHash);

    event OnChainQuoteInvalidated(
        address lenderVault,
        bytes32 onChainQuoteHash
    );
    event OffChainQuoteInvalidated(
        address lenderVault,
        bytes32 offChainQuoteHash
    );
}
