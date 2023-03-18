// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Constants} from "../Constants.sol";
import {DataTypes} from "./DataTypes.sol";
import {Errors} from "../Errors.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {IBorrowerGateway} from "./interfaces/IBorrowerGateway.sol";
import {ILenderVaultImpl} from "./interfaces/ILenderVaultImpl.sol";
import {IVaultCallback} from "./interfaces/IVaultCallback.sol";
import {IEvents} from "./interfaces/IEvents.sol";
import {IQuoteHandler} from "./interfaces/IQuoteHandler.sol";

contract BorrowerGateway is ReentrancyGuard, IEvents, IBorrowerGateway {
    using SafeERC20 for IERC20Metadata;

    // putting fee info in borrow gateway since borrower always pays this upfront
    address public immutable addressRegistry;
    uint256 public protocolFee; // in BASE

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    function borrowWithOffChainQuote(
        address lenderVault,
        DataTypes.BorrowTransferInstructions calldata borrowInstructions,
        DataTypes.OffChainQuote calldata offChainQuote,
        DataTypes.QuoteTuple calldata quoteTuple,
        bytes32[] memory proof
    ) external nonReentrant {
        checkDeadlineAndRegisteredVault(
            borrowInstructions.deadline,
            lenderVault
        );
        {
            address quoteHandler = IAddressRegistry(addressRegistry)
                .quoteHandler();
            IQuoteHandler(quoteHandler).checkAndRegisterOffChainQuote(
                msg.sender,
                lenderVault,
                offChainQuote,
                quoteTuple,
                proof
            );
        }

        (
            DataTypes.Loan memory loan,
            uint256 loanId,
            uint256 upfrontFee,
            address collReceiver
        ) = ILenderVaultImpl(lenderVault).processQuote(
                msg.sender,
                borrowInstructions,
                offChainQuote.generalQuoteInfo,
                quoteTuple
            );

        processTransfers(
            lenderVault,
            collReceiver,
            borrowInstructions,
            loan,
            upfrontFee
        );

        emit Borrow(
            lenderVault,
            loan.borrower,
            loan,
            loanId,
            borrowInstructions.callbackAddr,
            borrowInstructions.callbackData
        );
    }

    function borrowWithOnChainQuote(
        address lenderVault,
        DataTypes.BorrowTransferInstructions calldata borrowInstructions,
        DataTypes.OnChainQuote calldata onChainQuote,
        uint256 quoteTupleIdx
    ) external nonReentrant {
        // borrow gateway just forwards data to respective vault and orchestrates transfers
        // borrow gateway is oblivious towards and specific borrow details, and only fwds info
        // vaults needs to check details of given quote and whether it's valid
        // all lenderVaults need to approve BorrowGateway

        // 1. BorrowGateway "optimistically" pulls loanToken from lender vault: either transfers directly to (a) borrower or (b) callbacker for further processing
        // 2. BorrowGateway then pulls collToken from borrower to lender vault
        // 3. Finally, BorrowGateway updates lender vault storage state

        checkDeadlineAndRegisteredVault(
            borrowInstructions.deadline,
            lenderVault
        );
        {
            address quoteHandler = IAddressRegistry(addressRegistry)
                .quoteHandler();
            IQuoteHandler(quoteHandler).checkAndRegisterOnChainQuote(
                msg.sender,
                lenderVault,
                onChainQuote
            );
        }
        DataTypes.QuoteTuple memory quoteTuple = onChainQuote.quoteTuples[
            quoteTupleIdx
        ];
        (
            DataTypes.Loan memory loan,
            uint256 loanId,
            uint256 upfrontFee,
            address collReceiver
        ) = ILenderVaultImpl(lenderVault).processQuote(
                msg.sender,
                borrowInstructions,
                onChainQuote.generalQuoteInfo,
                quoteTuple
            );

        processTransfers(
            lenderVault,
            collReceiver,
            borrowInstructions,
            loan,
            upfrontFee
        );

        emit Borrow(
            lenderVault,
            loan.borrower,
            loan,
            loanId,
            borrowInstructions.callbackAddr,
            borrowInstructions.callbackData
        );
    }

    function repay(
        DataTypes.LoanRepayInstructions calldata loanRepayInstructions,
        address vaultAddr,
        address callbackAddr,
        bytes calldata callbackData
    ) external nonReentrant {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(vaultAddr)) {
            revert Errors.UnregisteredVault();
        }

        DataTypes.Loan memory loan = ILenderVaultImpl(vaultAddr).loans(
            loanRepayInstructions.targetLoanId
        );

        ILenderVaultImpl(vaultAddr).validateRepayInfo(
            msg.sender,
            loan,
            loanRepayInstructions
        );

        uint256 reclaimCollAmount = processRepayTransfers(
            vaultAddr,
            loanRepayInstructions,
            loan,
            callbackAddr,
            callbackData
        );

        ILenderVaultImpl(vaultAddr).updateLoanInfo(
            loan,
            loanRepayInstructions.targetRepayAmount,
            loanRepayInstructions.targetLoanId,
            reclaimCollAmount
        );

        emit Repay(
            vaultAddr,
            loanRepayInstructions.targetLoanId,
            loanRepayInstructions.targetRepayAmount
        );
    }

    function setNewProtocolFee(uint256 _newFee) external {
        if (msg.sender != IAddressRegistry(addressRegistry).owner()) {
            revert Errors.InvalidSender();
        }
        if (_newFee > Constants.MAX_FEE_PER_ANNUM) {
            revert Errors.InvalidFee();
        }
        protocolFee = _newFee;
        emit NewProtocolFee(_newFee);
    }

    function processTransfers(
        address lenderVault,
        address collReceiver,
        DataTypes.BorrowTransferInstructions calldata borrowInstructions,
        DataTypes.Loan memory loan,
        uint256 upfrontFee
    ) internal {
        if (borrowInstructions.callbackAddr == address(0)) {
            ILenderVaultImpl(lenderVault).transferTo(
                loan.loanToken,
                loan.borrower,
                loan.initLoanAmount
            );
        } else {
            if (
                !IAddressRegistry(addressRegistry).isWhitelistedCallbackAddr(
                    borrowInstructions.callbackAddr
                )
            ) {
                revert Errors.NonWhitelistedCallback();
            }
            ILenderVaultImpl(lenderVault).transferTo(
                loan.loanToken,
                borrowInstructions.callbackAddr,
                loan.initLoanAmount
            );
            IVaultCallback(borrowInstructions.callbackAddr).borrowCallback(
                loan,
                borrowInstructions.callbackData
            );
        }

        uint256 collTokenReceived = IERC20Metadata(loan.collToken).balanceOf(
            collReceiver
        );

        // protocol fees on whole sendAmount
        // this will make calculation of upfrontFee be protocolFeeAmount + (collSendAmount - protocolFeeAmount)*(tokenFee/collUnit)
        uint256 protocolFeeAmount = ((borrowInstructions.collSendAmount) *
            protocolFee *
            (loan.expiry - block.timestamp)) /
            (Constants.BASE * Constants.YEAR_IN_SECONDS);

        // should only happen when tenor >> 1 year
        // e.g. at 5% MAX_FEE_PER_ANNUM, tenor still needs to be 20 years
        if (borrowInstructions.collSendAmount < protocolFeeAmount) {
            revert Errors.InsufficientSendAmount();
        }

        if (protocolFeeAmount != 0) {
            IERC20Metadata(loan.collToken).safeTransferFrom(
                loan.borrower,
                IAddressRegistry(addressRegistry).owner(),
                protocolFeeAmount
            );
        }

        IERC20Metadata(loan.collToken).safeTransferFrom(
            loan.borrower,
            collReceiver,
            borrowInstructions.collSendAmount - protocolFeeAmount
        );

        collTokenReceived =
            IERC20Metadata(loan.collToken).balanceOf(collReceiver) -
            collTokenReceived;

        if (collTokenReceived != loan.initCollAmount + upfrontFee) {
            revert Errors.InvalidSendAmount();
        }
    }

    function processRepayTransfers(
        address lenderVault,
        DataTypes.LoanRepayInstructions memory loanRepayInstructions,
        DataTypes.Loan memory loan,
        address callbackAddr,
        bytes calldata callbackData
    ) internal returns (uint256 reclaimCollAmount) {
        reclaimCollAmount =
            (loan.initCollAmount * loanRepayInstructions.targetRepayAmount) /
            loan.initRepayAmount;
        if (callbackAddr == address(0)) {
            if (loan.collTokenCompartmentAddr != address(0)) {
                ILenderVaultImpl(lenderVault).transferCollFromCompartment(
                    loanRepayInstructions.targetRepayAmount,
                    loan.initRepayAmount - loan.amountRepaidSoFar,
                    loan.borrower,
                    loan.collToken,
                    callbackAddr,
                    loan.collTokenCompartmentAddr
                );
            } else {
                ILenderVaultImpl(lenderVault).transferTo(
                    loan.collToken,
                    loan.borrower,
                    reclaimCollAmount
                );
            }
        } else {
            if (
                !IAddressRegistry(addressRegistry).isWhitelistedCallbackAddr(
                    callbackAddr
                )
            ) {
                revert Errors.NonWhitelistedCallback();
            }
            if (loan.collTokenCompartmentAddr != address(0)) {
                ILenderVaultImpl(lenderVault).transferCollFromCompartment(
                    loanRepayInstructions.targetRepayAmount,
                    loan.initRepayAmount - loan.amountRepaidSoFar,
                    loan.borrower,
                    loan.collToken,
                    callbackAddr,
                    loan.collTokenCompartmentAddr
                );
                IVaultCallback(callbackAddr).repayCallback(loan, callbackData);
            } else {
                ILenderVaultImpl(lenderVault).transferTo(
                    loan.collToken,
                    callbackAddr,
                    reclaimCollAmount
                );
                IVaultCallback(callbackAddr).repayCallback(loan, callbackData);
            }
        }

        uint256 loanTokenReceived = IERC20Metadata(loan.loanToken).balanceOf(
            lenderVault
        );

        IERC20Metadata(loan.loanToken).safeTransferFrom(
            loan.borrower,
            lenderVault,
            uint256(loanRepayInstructions.targetRepayAmount) +
                loanRepayInstructions.expectedTransferFee
        );

        loanTokenReceived =
            IERC20Metadata(loan.loanToken).balanceOf(lenderVault) -
            loanTokenReceived;
        if (loanTokenReceived != loanRepayInstructions.targetRepayAmount) {
            revert Errors.InvalidSendAmount();
        }
    }

    function checkDeadlineAndRegisteredVault(
        uint256 deadline,
        address lenderVault
    ) internal view {
        if (block.timestamp > deadline) {
            revert Errors.DeadlinePassed();
        }
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
    }
}
