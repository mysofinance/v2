// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface ILenderVaultImpl {
    function initialize(address vaultOwner, address addressRegistry) external;

    function unlockCollateral(
        address collToken,
        uint256[] calldata _loanIds,
        bool autoWithdraw
    ) external;

    function updateLoanInfo(
        DataTypes.Loan memory loan,
        uint128 repayAmount,
        uint256 loanId,
        uint256 collAmount,
        bool isRepay
    ) external;

    function processQuote(
        address borrower,
        DataTypes.BorrowTransferInstructions calldata borrowInstructions,
        DataTypes.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypes.QuoteTuple calldata quoteTuple
    )
        external
        returns (
            DataTypes.Loan memory loan,
            uint256 loanId,
            uint256 upfrontFee,
            address collReceiver
        );

    function withdraw(address token, uint256 amount) external;

    function transferTo(
        address token,
        address recipient,
        uint256 amount
    ) external;

    function transferCollFromCompartment(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr,
        address collTokenCompartmentAddr
    ) external;

    function setMinNumOfSigners(uint256 _minNumOfSigners) external;

    function addSigners(address[] calldata _signers) external;

    function removeSigner(address signer, uint256 signerIdx) external;

    function loans(
        uint256 index
    ) external view returns (DataTypes.Loan memory loan);

    function validateRepayInfo(
        address borrower,
        DataTypes.Loan memory loan,
        DataTypes.LoanRepayInstructions memory loanRepayInstructions
    ) external view;

    function owner() external view returns (address);

    function addressRegistry() external view returns (address);

    function signers(uint256) external view returns (address);

    function minNumOfSigners() external view returns (uint256);

    function isSigner(address signer) external view returns (bool);

    function withdrawEntered() external view returns (bool);

    function lockedAmounts(address) external view returns (uint256);
}
