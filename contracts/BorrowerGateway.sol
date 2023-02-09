// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {IBorrowerCompartmentFactory} from "./interfaces/IBorrowerCompartmentFactory.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {IVaultCallback} from "./interfaces/IVaultCallback.sol";
import {DataTypes} from "./DataTypes.sol";

contract BorrowerGateway is ReentrancyGuard {
    address immutable addressRegistry;

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    using SafeERC20 for IERC20Metadata;

    function borrowWithOffChainQuote(
        address lenderVault,
        address borrower,
        uint256 collSendAmount,
        DataTypes.OffChainQuote calldata offChainQuote,
        address callbackAddr,
        bytes calldata data
    ) external nonReentrant {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }

        (bool doesAccept, bytes32 offChainQuoteHash) = ILenderVault(lenderVault)
            .doesAcceptOffChainQuote(borrower, offChainQuote);
        if (!doesAccept) {
            revert();
        }
        ILenderVault(lenderVault).invalidateOffChainQuote(offChainQuoteHash);
        (DataTypes.Loan memory loan, uint256 upfrontFee) = ILenderVault(
            lenderVault
        ).getLoanInfoForOffChainQuote(borrower, offChainQuote);
        uint256 loanId = ILenderVault(lenderVault).addLoan(loan);
        address collReceiver = getCollReceiver(
            offChainQuote.borrowerCompartmentImplementation,
            lenderVault,
            borrower,
            loanId
        );
        processTransfers(
            lenderVault,
            collReceiver,
            collSendAmount,
            loan,
            upfrontFee,
            callbackAddr,
            data
        );
    }

    function borrowWithOnChainQuote(
        address lenderVault,
        address borrower,
        uint256 collSendAmount,
        DataTypes.OnChainQuote calldata onChainQuote,
        bool isAutoQuote,
        address callbackAddr,
        bytes calldata data
    ) external nonReentrant {
        // borrow gateway just forwards data to respective vault and orchestrates transfers
        // borrow gateway is oblivious towards and specific borrow details, and only fwds info
        // vaults needs to check details of given quote and whether it's valid
        // all lenderVaults need to approve BorrowGateway

        // 1. BorrowGateway "optimistically" pulls loanToken from lender vault: either transfers directly to (a) borrower or (b) callbacker for further processing
        // 2. BorrowGateway then pulls collTOken from borrower to lender vault
        // 3. Finally, BorrowGateway updates lender vault storage state

        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (
            !isAutoQuote &&
            !ILenderVault(lenderVault).doesAcceptOnChainQuote(onChainQuote)
        ) {
            revert();
        }
        if (
            isAutoQuote &&
            !ILenderVault(lenderVault).doesAcceptAutoQuote(onChainQuote)
        ) {
            revert();
        }
        (DataTypes.Loan memory loan, uint256 upfrontFee) = ILenderVault(
            lenderVault
        ).getLoanInfoForOnChainQuote(borrower, collSendAmount, onChainQuote);
        uint256 loanId = ILenderVault(lenderVault).addLoan(loan);

        address collReceiver = getCollReceiver(
            onChainQuote.borrowerCompartmentImplementation,
            lenderVault,
            borrower,
            loanId
        );
        processTransfers(
            lenderVault,
            collReceiver,
            collSendAmount,
            loan,
            upfrontFee,
            callbackAddr,
            data
        );
    }

    function getCollReceiver(
        address borrowerCompartmentImplementation,
        address lenderVault,
        address borrower,
        uint256 loanId
    ) internal returns (address collReceiver) {
        if (borrowerCompartmentImplementation != address(0)) {
            if (
                IAddressRegistry(addressRegistry).isWhitelistedCollTokenHandler(
                    borrowerCompartmentImplementation
                )
            ) {
                revert();
            }
            collReceiver = IBorrowerCompartmentFactory(
                IAddressRegistry(addressRegistry).borrowerCompartmentFactory()
            ).createCompartment(
                    borrowerCompartmentImplementation,
                    lenderVault,
                    borrower,
                    loanId
                );
        } else {
            collReceiver = lenderVault;
        }
    }

    function processTransfers(
        address lenderVault,
        address collReceiver,
        uint256 collSendAmount,
        DataTypes.Loan memory loan,
        uint256 upfrontFee,
        address callbackAddr,
        bytes calldata data
    ) internal {
        if (callbackAddr == address(0)) {
            ILenderVault(lenderVault).transferTo(
                loan.loanToken,
                loan.borrower,
                loan.initLoanAmount
            );
        } else {
            if (
                !IAddressRegistry(addressRegistry).isWhitelistedCallbackAddr(
                    callbackAddr
                )
            ) {
                revert();
            }
            ILenderVault(lenderVault).transferTo(
                loan.loanToken,
                callbackAddr,
                loan.initLoanAmount
            );
            IVaultCallback(callbackAddr).borrowCallback(loan, data);
        }

        uint256 collTokenReceived = IERC20Metadata(loan.collToken).balanceOf(
            lenderVault
        );
        IERC20Metadata(loan.collToken).safeTransferFrom(
            loan.borrower,
            collReceiver,
            collSendAmount
        );
        collTokenReceived =
            IERC20Metadata(loan.collToken).balanceOf(lenderVault) -
            collTokenReceived;
        if (collTokenReceived != loan.initCollAmount + upfrontFee) {
            revert();
        }
    }

    /*

    function repay(
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        address callbackAddr,
        bytes calldata data
    ) external nonReentrant {
        DataTypes.Loan memory loan = loans[loanRepayInfo.loanId];
        if (msg.sender != loan.borrower) {
            revert Invalid();
        }
        if (
            block.timestamp < loan.earliestRepay ||
            block.timestamp >= loan.expiry
        ) {
            revert Invalid();
        }
        if (
            loanRepayInfo.repayAmount >
            loan.initRepayAmount - loan.amountRepaidSoFar
        ) {
            revert Invalid();
        }
        uint128 reclaimCollAmount = toUint128(
            (loan.initCollAmount * loanRepayInfo.repayAmount) /
                loan.initRepayAmount
        );

        uint256 loanTokenBalBefore = IERC20Metadata(loanRepayInfo.loanToken)
            .balanceOf(address(this));
        // uint256 collTokenBalBefore = IERC20Metadata(loanRepayInfo.collToken)
        //     .balanceOf(address(this));

        if (loan.hasCollCompartment) {
            ICompartment(loan.collTokenCompartmentAddr).transferCollToBorrower(
                loanRepayInfo.repayAmount,
                loan.initRepayAmount - loan.amountRepaidSoFar,
                loan.borrower,
                loan.collToken
            );
        } else {
            IERC20Metadata(loanRepayInfo.collToken).safeTransfer(
                msg.sender,
                reclaimCollAmount
            );
        }

        if (callbackAddr != address(0)) {
            IVaultCallback(callbackAddr).repayCallback(loan, data); // todo: whitelist callbackAddr
        }
        IERC20Metadata(loanRepayInfo.loanToken).safeTransferFrom(
            msg.sender,
            address(this),
            loanRepayInfo.repayAmount + loanRepayInfo.loanTokenTransferFees
        );

        uint256 loanTokenBalAfter = IERC20Metadata(loanRepayInfo.loanToken)
            .balanceOf(address(this));

        uint128 loanTokenAmountReceived = toUint128(
            loanTokenBalAfter - loanTokenBalBefore
        );
        // uint256 collTokenBalAfter = IERC20Metadata(loanRepayInfo.collToken)
        //     .balanceOf(address(this));

        if (loanTokenAmountReceived < loanRepayInfo.repayAmount) {
            revert Invalid();
        }
        // balance only changes when no compartment
        // if (
        //     !loan.hasCollCompartment &&
        //     collTokenBalBefore - collTokenBalAfter < reclaimCollAmount
        // ) {
        //     revert Invalid();
        // }

        loan.amountRepaidSoFar += loanTokenAmountReceived;
        // only update lockedAmounts when no compartment
        if (!loan.hasCollCompartment) {
            lockedAmounts[loanRepayInfo.collToken] -= reclaimCollAmount;
        }
    }
    */
}
