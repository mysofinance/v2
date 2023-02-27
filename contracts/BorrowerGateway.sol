// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";
import {IVaultCallback} from "./interfaces/IVaultCallback.sol";
import {DataTypes} from "./DataTypes.sol";
import {IBorrowerGateway} from "./interfaces/IBorrowerGateway.sol";
import {IQuoteHandler} from "./interfaces/IQuoteHandler.sol";

contract BorrowerGateway is ReentrancyGuard, IBorrowerGateway {
    // putting fee info in borrow gateway since borrower always pays this upfront
    uint256 constant BASE = 1e18;
    uint256 constant YEAR_IN_SECONDS = 31_536_000; // 365*24*3600
    uint256 constant MAX_FEE = 5e16; // 5% max in base
    address immutable addressRegistry;
    uint256 public protocolFee; // in BASE

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    using SafeERC20 for IERC20Metadata;

    error UnregisteredVault();
    error InvalidSender();
    error InvalidFee();
    error InsufficientSendAmount();

    event NewProtocolFee(uint256 _newFee);

    function borrowWithOffChainQuote(
        address lenderVault,
        uint256 collSendAmount,
        uint256 expectedTransferFee,
        DataTypes.OffChainQuote calldata offChainQuote,
        DataTypes.QuoteTuple calldata quoteTuple,
        bytes32[] memory proof,
        address callbackAddr,
        bytes calldata callbackData
    ) external nonReentrant {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert UnregisteredVault();
        }
        address quoteHandler = IAddressRegistry(addressRegistry).quoteHandler();
        IQuoteHandler(quoteHandler).checkAndRegisterOffChainQuote(
            msg.sender,
            lenderVault,
            offChainQuote,
            quoteTuple,
            proof
        );

        (
            DataTypes.Loan memory loan,
            uint256 loanId,
            uint256 upfrontFee,
            address collReceiver
        ) = ILenderVault(lenderVault).processQuote(
                msg.sender,
                collSendAmount,
                expectedTransferFee,
                offChainQuote.generalQuoteInfo,
                quoteTuple
            );

        processTransfers(
            lenderVault,
            collReceiver,
            collSendAmount,
            loan,
            upfrontFee,
            callbackAddr,
            callbackData
        );

        emit Borrow(
            lenderVault,
            loan.borrower,
            loan.collToken,
            loan.loanToken,
            loan.expiry,
            loan.earliestRepay,
            loan.initCollAmount,
            loan.initLoanAmount,
            loan.initRepayAmount,
            loan.amountRepaidSoFar,
            loan.collUnlocked,
            loan.collTokenCompartmentAddr,
            loanId
        );
    }

    function borrowWithOnChainQuote(
        address lenderVault,
        uint256 collSendAmount,
        uint256 expectedTransferFee,
        DataTypes.OnChainQuote calldata onChainQuote,
        uint256 quoteTupleIdx,
        address callbackAddr,
        bytes calldata callbackData
    ) external nonReentrant {
        // borrow gateway just forwards data to respective vault and orchestrates transfers
        // borrow gateway is oblivious towards and specific borrow details, and only fwds info
        // vaults needs to check details of given quote and whether it's valid
        // all lenderVaults need to approve BorrowGateway

        // 1. BorrowGateway "optimistically" pulls loanToken from lender vault: either transfers directly to (a) borrower or (b) callbacker for further processing
        // 2. BorrowGateway then pulls collToken from borrower to lender vault
        // 3. Finally, BorrowGateway updates lender vault storage state

        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert UnregisteredVault();
        }
        address quoteHandler = IAddressRegistry(addressRegistry).quoteHandler();
        IQuoteHandler(quoteHandler).checkAndRegisterOnChainQuote(
            msg.sender,
            lenderVault,
            onChainQuote
        );
        DataTypes.QuoteTuple memory quoteTuple = onChainQuote.quoteTuples[
            quoteTupleIdx
        ];
        (
            DataTypes.Loan memory loan,
            uint256 loanId,
            uint256 upfrontFee,
            address collReceiver
        ) = ILenderVault(lenderVault).processQuote(
                msg.sender,
                collSendAmount,
                expectedTransferFee,
                onChainQuote.generalQuoteInfo,
                quoteTuple
            );

        processTransfers(
            lenderVault,
            collReceiver,
            collSendAmount,
            loan,
            upfrontFee,
            callbackAddr,
            callbackData
        );

        emit Borrow(
            lenderVault,
            loan.borrower,
            loan.collToken,
            loan.loanToken,
            loan.expiry,
            loan.earliestRepay,
            loan.initCollAmount,
            loan.initLoanAmount,
            loan.initRepayAmount,
            loan.amountRepaidSoFar,
            loan.collUnlocked,
            loan.collTokenCompartmentAddr,
            loanId
        );
    }

    function processTransfers(
        address lenderVault,
        address collReceiver,
        uint256 collSendAmount,
        DataTypes.Loan memory loan,
        uint256 upfrontFee,
        address callbackAddr,
        bytes calldata callbackData
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
            IVaultCallback(callbackAddr).borrowCallback(loan, callbackData);
        }

        uint256 collTokenReceived = IERC20Metadata(loan.collToken).balanceOf(
            collReceiver
        );

        // protocol fees on whole sendAmount
        // this will make calculation of upfrontFee be protocolFeeAmount + (collSendAmount - protocolFeeAmount)*(tokenFee/collUnit)
        uint256 protocolFeeAmount = ((collSendAmount) *
            protocolFee *
            (loan.expiry - block.timestamp)) / (BASE * YEAR_IN_SECONDS);

        if (collSendAmount < protocolFeeAmount) {
            revert InsufficientSendAmount();
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
            collSendAmount - protocolFeeAmount
        );

        collTokenReceived =
            IERC20Metadata(loan.collToken).balanceOf(collReceiver) -
            collTokenReceived;

        if (collTokenReceived != loan.initCollAmount + upfrontFee) {
            revert(); // InsufficientSendAmount();
        }
    }

    function processRepayTransfers(
        address lenderVault,
        DataTypes.LoanRepayInfo memory loanRepayInfo,
        DataTypes.Loan memory loan,
        address callbackAddr,
        bytes calldata callbackData
    ) internal returns (uint256 reclaimCollAmount) {
        reclaimCollAmount =
            (loan.initCollAmount * loanRepayInfo.repayAmount) /
            loan.initRepayAmount;
        if (callbackAddr == address(0)) {
            if (loan.collTokenCompartmentAddr != address(0)) {
                ILenderVault(lenderVault).transferFromCompartment(
                    loanRepayInfo.repayAmount,
                    loan.initRepayAmount - loan.amountRepaidSoFar,
                    loan.borrower,
                    loan.collToken,
                    callbackAddr,
                    loan.collTokenCompartmentAddr
                );
            } else {
                ILenderVault(lenderVault).transferTo(
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
                revert();
            }
            uint256 collTokenBalBefore = IERC20(loan.collToken).balanceOf(
                callbackAddr
            );
            if (loan.collTokenCompartmentAddr != address(0)) {
                ILenderVault(lenderVault).transferFromCompartment(
                    loanRepayInfo.repayAmount,
                    loan.initRepayAmount - loan.amountRepaidSoFar,
                    loan.borrower,
                    loan.collToken,
                    callbackAddr,
                    loan.collTokenCompartmentAddr
                );
                IVaultCallback(callbackAddr).repayCallback(
                    loan,
                    collTokenBalBefore,
                    callbackData
                );
            } else {
                ILenderVault(lenderVault).transferTo(
                    loan.collToken,
                    callbackAddr,
                    reclaimCollAmount
                );
                IVaultCallback(callbackAddr).repayCallback(
                    loan,
                    collTokenBalBefore,
                    callbackData
                );
            }
        }

        uint256 loanTokenReceived = IERC20Metadata(loan.loanToken).balanceOf(
            lenderVault
        );

        IERC20Metadata(loan.loanToken).safeTransferFrom(
            loan.borrower,
            lenderVault,
            loanRepayInfo.repaySendAmount
        );

        loanTokenReceived =
            IERC20Metadata(loan.loanToken).balanceOf(lenderVault) -
            loanTokenReceived;

        if (loanTokenReceived != loanRepayInfo.repayAmount) {
            revert(); // InsufficientSendAmount();
        }
    }

    function setNewProtocolFee(uint256 _newFee) external {
        if (msg.sender != IAddressRegistry(addressRegistry).owner()) {
            revert InvalidSender();
        }
        if (_newFee > MAX_FEE) {
            revert InvalidFee();
        }
        protocolFee = _newFee;
        emit NewProtocolFee(_newFee);
    }

    function repay(
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        address vaultAddr,
        address callbackAddr,
        bytes calldata callbackData
    ) external nonReentrant {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(vaultAddr)) {
            revert UnregisteredVault();
        }

        DataTypes.Loan memory loan = ILenderVault(vaultAddr).loans(
            loanRepayInfo.loanId
        );

        ILenderVault(vaultAddr).validateRepayInfo(
            msg.sender,
            loan,
            loanRepayInfo
        );

        uint256 reclaimCollAmount = processRepayTransfers(
            vaultAddr,
            loanRepayInfo,
            loan,
            callbackAddr,
            callbackData
        );

        ILenderVault(vaultAddr).updateLoanInfo(
            loan,
            loanRepayInfo.repayAmount,
            loanRepayInfo.loanId,
            reclaimCollAmount,
            true
        );

        emit Repay(vaultAddr, loanRepayInfo.loanId, loanRepayInfo.repayAmount);
    }
}
