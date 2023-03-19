// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface IEvents {
    enum EventToggleType {
        CALLBACK,
        COMPARTMENT,
        ORACLE,
        TOKEN
    }

    event AddedSigners(address[] _signers);

    event MinNumberOfSignersSet(uint256 numSigners);

    event RemovedSigner(
        address signerRemoved,
        uint256 signerIdx,
        address signerMovedFromEnd
    );

    event CollateralUnlocked(
        address indexed vaultOwner,
        address indexed collToken,
        uint256[] loanIds,
        bool autoWithdraw
    );

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

    event NewVaultCreated(
        address indexed newLenderVaultAddr,
        address vaultOwner
    );

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

    event WhitelistAddressToggled(
        address[] indexed addressToggled,
        bool whitelistStatus,
        EventToggleType toggleType
    );
}
