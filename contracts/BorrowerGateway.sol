// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {IBorrowerCompartmentFactory} from "./interfaces/IBorrowerCompartmentFactory.sol";
import {IStakeCompartment} from "./interfaces/compartments/staking/IStakeCompartment.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {IVaultCallback} from "./interfaces/IVaultCallback.sol";
import {DataTypes} from "./DataTypes.sol";
import {IBorrowerGateway} from "./interfaces/IBorrowerGateway.sol";

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
        address borrower,
        uint256 collSendAmount,
        DataTypes.OffChainQuote calldata offChainQuote,
        address callbackAddr,
        bytes calldata callbackData,
        bytes calldata compartmentData
    ) external nonReentrant {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert UnregisteredVault();
        }

        {
            (bool doesAccept, bytes32 offChainQuoteHash) = ILenderVault(
                lenderVault
            ).doesAcceptOffChainQuote(borrower, offChainQuote);
            if (!doesAccept) {
                revert();
            }
            ILenderVault(lenderVault).invalidateOffChainQuote(
                offChainQuoteHash
            );
        }

        (DataTypes.Loan memory loan, uint256 upfrontFee) = ILenderVault(
            lenderVault
        ).getLoanInfoForOffChainQuote(borrower, offChainQuote);
        uint256 loanId = ILenderVault(lenderVault).addLoan(loan);
        address collReceiver = getCollReceiver(
            offChainQuote.borrowerCompartmentImplementation,
            lenderVault,
            borrower,
            loan.collToken,
            loanId
        );

        processTransfers(
            lenderVault,
            collReceiver,
            collSendAmount,
            loan,
            upfrontFee,
            callbackAddr,
            callbackData,
            compartmentData
        );

        emit Borrow(
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
            loan.collTokenCompartmentAddr
        );
    }

    function borrowWithOnChainQuote(
        address lenderVault,
        address borrower,
        uint256 collSendAmount,
        DataTypes.OnChainQuote calldata onChainQuote,
        bool isAutoQuote,
        address callbackAddr,
        bytes calldata callbackData,
        bytes calldata compartmentData
    ) external nonReentrant {
        // borrow gateway just forwards data to respective vault and orchestrates transfers
        // borrow gateway is oblivious towards and specific borrow details, and only fwds info
        // vaults needs to check details of given quote and whether it's valid
        // all lenderVaults need to approve BorrowGateway

        // 1. BorrowGateway "optimistically" pulls loanToken from lender vault: either transfers directly to (a) borrower or (b) callbacker for further processing
        // 2. BorrowGateway then pulls collTOken from borrower to lender vault
        // 3. Finally, BorrowGateway updates lender vault storage state

        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert UnregisteredVault();
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
            onChainQuote.collToken,
            loanId
        );

        processTransfers(
            lenderVault,
            collReceiver,
            collSendAmount,
            loan,
            upfrontFee,
            callbackAddr,
            callbackData,
            compartmentData
        );

        emit Borrow(
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
            loan.collTokenCompartmentAddr
        );
    }

    function getCollReceiver(
        address borrowerCompartmentImplementation,
        address lenderVault,
        address borrower,
        address collToken,
        uint256 loanId
    ) internal returns (address collReceiver) {
        if (borrowerCompartmentImplementation != address(0)) {
            address _addressRegistry = addressRegistry;
            if (
                IAddressRegistry(_addressRegistry)
                    .isWhitelistedCollTokenHandler(
                        borrowerCompartmentImplementation
                    )
            ) {
                revert();
            }
            collReceiver = IBorrowerCompartmentFactory(
                IAddressRegistry(_addressRegistry).borrowerCompartmentFactory()
            ).createCompartment(
                    borrowerCompartmentImplementation,
                    lenderVault,
                    borrower,
                    collToken,
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
        bytes calldata callbackData,
        bytes calldata compartmentData
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

        // protocol fees only on what lender vault actually receives
        // so any token transfer fees to protocol owner don't hurt lender...
        // todo: up for discussion if we want to change that
        uint256 protocolFeeAmount = ((loan.initCollAmount + upfrontFee) *
            protocolFee *
            (loan.expiry - block.timestamp)) / (BASE * YEAR_IN_SECONDS);

        if (collSendAmount < protocolFeeAmount) {
            revert InsufficientSendAmount();
        }

        IERC20Metadata(loan.collToken).safeTransferFrom(
            loan.borrower,
            IAddressRegistry(addressRegistry).owner(),
            protocolFeeAmount
        );

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

        if (loan.collTokenCompartmentAddr != address(0)) {
            IStakeCompartment(loan.collTokenCompartmentAddr).stake(
                addressRegistry,
                loan.collToken,
                compartmentData
            );
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

    /*

    function repay(
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        address vaultAddr,
        address callbackAddr,
        bytes calldata data
    ) external nonReentrant {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert UnregisteredVault();
        }
        DataTypes.Loan memory loan = ILenderVault(vaultAddr).loans(loanRepayInfo.loanId);
        uint128 reclaimCollAmount = ILenderVault(vaultAddr).validateRepayInfo(msg.sender, loan, loanRepayInfo);

        uint256 loanTokenBalBefore = IERC20Metadata(loanRepayInfo.loanToken)
            .balanceOf(address(this));
        // uint256 collTokenBalBefore = IERC20Metadata(loanRepayInfo.collToken)
        //     .balanceOf(address(this));

        if (loan.hasCollCompartment) {
            ICompartment(loan.collTokenCompartmentAddr).transferCollFromCompartment(
                loanRepayInfo.repayAmount,
                loan.initRepayAmount - loan.amountRepaidSoFar,
                loan.borrower,
                loan.collToken,
                callbackAddr
            );
        } else {
            IERC20Metadata(loanRepayInfo.collToken).safeTransfer(
                msg.sender,
                reclaimCollAmount
            );
        }

        if (callbackAddr != address(0)) {
            IVaultCallback(callbackAddr).repayCallback(loan, data);
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
