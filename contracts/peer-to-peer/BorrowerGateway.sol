// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Constants} from "../Constants.sol";
import {DataTypesPeerToPeer} from "./DataTypesPeerToPeer.sol";
import {Errors} from "../Errors.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {IBaseCompartment} from "./interfaces/compartments/IBaseCompartment.sol";
import {IBorrowerGateway} from "./interfaces/IBorrowerGateway.sol";
import {ILenderVaultImpl} from "./interfaces/ILenderVaultImpl.sol";
import {IMysoTokenManager} from "../interfaces/IMysoTokenManager.sol";
import {IQuoteHandler} from "./interfaces/IQuoteHandler.sol";
import {IVaultCallback} from "./interfaces/IVaultCallback.sol";

contract BorrowerGateway is ReentrancyGuard, IBorrowerGateway {
    using SafeERC20 for IERC20Metadata;

    // putting fee info in borrow gateway since borrower always pays this upfront
    address public immutable addressRegistry;
    // index 0: base protocol fee is paid even for swap (no tenor)
    // index 1: protocol fee slope scales protocol fee with tenor
    uint256[2] internal protocolFeeParams;

    constructor(address _addressRegistry) {
        if (_addressRegistry == address(0)) {
            revert Errors.InvalidAddress();
        }
        addressRegistry = _addressRegistry;
    }

    function borrowWithOffChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.BorrowTransferInstructions
            calldata borrowInstructions,
        DataTypesPeerToPeer.OffChainQuote calldata offChainQuote,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple,
        bytes32[] calldata proof
    ) external nonReentrant {
        _checkDeadlineAndRegisteredVault(
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
            DataTypesPeerToPeer.Loan memory loan,
            uint256 loanId,
            DataTypesPeerToPeer.TransferInstructions memory transferInstructions
        ) = ILenderVaultImpl(lenderVault).processQuote(
                msg.sender,
                borrowInstructions,
                offChainQuote.generalQuoteInfo,
                quoteTuple
            );

        _processTransfers(
            lenderVault,
            borrowInstructions,
            loan,
            transferInstructions
        );

        emit Borrowed(
            lenderVault,
            loan.borrower,
            loan,
            transferInstructions.upfrontFee,
            loanId,
            borrowInstructions.callbackAddr,
            borrowInstructions.callbackData
        );
    }

    function borrowWithOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.BorrowTransferInstructions
            calldata borrowInstructions,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote,
        uint256 quoteTupleIdx
    ) external nonReentrant {
        // borrow gateway just forwards data to respective vault and orchestrates transfers
        // borrow gateway is oblivious towards and specific borrow details, and only fwds info
        // vaults needs to check details of given quote and whether it's valid
        // all lenderVaults need to approve BorrowGateway

        // 1. BorrowGateway "optimistically" pulls loanToken from lender vault: either transfers directly to (a) borrower or (b) callbacker for further processing
        // 2. BorrowGateway then pulls collToken from borrower to lender vault
        // 3. Finally, BorrowGateway updates lender vault storage state

        _checkDeadlineAndRegisteredVault(
            borrowInstructions.deadline,
            lenderVault
        );
        {
            address quoteHandler = IAddressRegistry(addressRegistry)
                .quoteHandler();
            IQuoteHandler(quoteHandler).checkAndRegisterOnChainQuote(
                msg.sender,
                lenderVault,
                quoteTupleIdx,
                onChainQuote
            );
        }
        DataTypesPeerToPeer.QuoteTuple memory quoteTuple = onChainQuote
            .quoteTuples[quoteTupleIdx];
        (
            DataTypesPeerToPeer.Loan memory loan,
            uint256 loanId,
            DataTypesPeerToPeer.TransferInstructions memory transferInstructions
        ) = ILenderVaultImpl(lenderVault).processQuote(
                msg.sender,
                borrowInstructions,
                onChainQuote.generalQuoteInfo,
                quoteTuple
            );

        _processTransfers(
            lenderVault,
            borrowInstructions,
            loan,
            transferInstructions
        );

        emit Borrowed(
            lenderVault,
            loan.borrower,
            loan,
            transferInstructions.upfrontFee,
            loanId,
            borrowInstructions.callbackAddr,
            borrowInstructions.callbackData
        );
    }

    function repay(
        DataTypesPeerToPeer.LoanRepayInstructions
            calldata loanRepayInstructions,
        address vaultAddr
    ) external nonReentrant {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(vaultAddr)) {
            revert Errors.UnregisteredVault();
        }
        if (
            loanRepayInstructions.callbackAddr != address(0) &&
            IAddressRegistry(addressRegistry).whitelistState(
                loanRepayInstructions.callbackAddr
            ) !=
            DataTypesPeerToPeer.WhitelistState.CALLBACK
        ) {
            revert Errors.NonWhitelistedCallback();
        }
        ILenderVaultImpl lenderVault = ILenderVaultImpl(vaultAddr);
        DataTypesPeerToPeer.Loan memory loan = lenderVault.loan(
            loanRepayInstructions.targetLoanId
        );
        if (msg.sender != loan.borrower) {
            revert Errors.InvalidBorrower();
        }
        if (
            block.timestamp < loan.earliestRepay ||
            block.timestamp >= loan.expiry
        ) {
            revert Errors.OutsideValidRepayWindow();
        }
        // checks repayAmount <= remaining loan balance
        if (
            loanRepayInstructions.targetRepayAmount == 0 ||
            loanRepayInstructions.targetRepayAmount + loan.amountRepaidSoFar >
            loan.initRepayAmount
        ) {
            revert Errors.InvalidRepayAmount();
        }
        bool noCompartment = loan.collTokenCompartmentAddr == address(0);
        // @dev: amountReclaimedSoFar cannot exceed initCollAmount for non-compartmentalized assets
        uint256 maxReclaimableCollAmount = noCompartment
            ? loan.initCollAmount - loan.amountReclaimedSoFar
            : IBaseCompartment(loan.collTokenCompartmentAddr)
                .getReclaimableBalance(
                    loan.initCollAmount,
                    loan.amountReclaimedSoFar,
                    loan.collToken
                );

        // @dev: amountRepaidSoFar cannot exceed initRepayAmount
        uint128 leftRepaymentAmount = loan.initRepayAmount -
            loan.amountRepaidSoFar;
        uint128 reclaimCollAmount;
        if (leftRepaymentAmount == loanRepayInstructions.targetRepayAmount) {
            reclaimCollAmount = SafeCast.toUint128(maxReclaimableCollAmount);
        } else {
            reclaimCollAmount = SafeCast.toUint128(
                (maxReclaimableCollAmount *
                    uint256(loanRepayInstructions.targetRepayAmount)) /
                    uint256(leftRepaymentAmount)
            );
            if (noCompartment && reclaimCollAmount == 0) {
                revert Errors.ReclaimAmountIsZero();
            }
        }

        lenderVault.updateLoanInfo(
            loanRepayInstructions.targetRepayAmount,
            loanRepayInstructions.targetLoanId,
            reclaimCollAmount,
            noCompartment,
            loan.collToken
        );

        _processRepayTransfers(
            vaultAddr,
            loanRepayInstructions,
            loan,
            leftRepaymentAmount,
            reclaimCollAmount,
            noCompartment
        );

        emit Repaid(
            vaultAddr,
            loanRepayInstructions.targetLoanId,
            loanRepayInstructions.targetRepayAmount
        );
    }

    /**
     * @notice Protocol fee is allowed to be zero, so no min fee checks, only max fee checks
     */
    function setProtocolFeeParams(uint256[2] calldata _newFeeParams) external {
        if (msg.sender != IAddressRegistry(addressRegistry).owner()) {
            revert Errors.InvalidSender();
        }
        if (
            _newFeeParams[0] > Constants.MAX_SWAP_PROTOCOL_FEE ||
            _newFeeParams[1] > Constants.MAX_FEE_PER_ANNUM
        ) {
            revert Errors.InvalidFee();
        }
        protocolFeeParams = _newFeeParams;
        emit ProtocolFeeSet(_newFeeParams);
    }

    function getProtocolFeeParams() external view returns (uint256[2] memory) {
        return protocolFeeParams;
    }

    function _processTransfers(
        address lenderVault,
        DataTypesPeerToPeer.BorrowTransferInstructions
            calldata borrowInstructions,
        DataTypesPeerToPeer.Loan memory loan,
        DataTypesPeerToPeer.TransferInstructions memory transferInstructions
    ) internal {
        IAddressRegistry registry = IAddressRegistry(addressRegistry);
        if (
            borrowInstructions.callbackAddr != address(0) &&
            registry.whitelistState(borrowInstructions.callbackAddr) !=
            DataTypesPeerToPeer.WhitelistState.CALLBACK
        ) {
            revert Errors.NonWhitelistedCallback();
        }
        ILenderVaultImpl(lenderVault).transferTo(
            loan.loanToken,
            borrowInstructions.callbackAddr == address(0)
                ? loan.borrower
                : borrowInstructions.callbackAddr,
            loan.initLoanAmount
        );
        if (borrowInstructions.callbackAddr != address(0)) {
            IVaultCallback(borrowInstructions.callbackAddr).borrowCallback(
                loan,
                borrowInstructions.callbackData
            );
        }

        uint256[2] memory currProtocolFeeParams = protocolFeeParams;
        uint256[2] memory applicableProtocolFeeParams = currProtocolFeeParams;

        address mysoTokenManager = registry.mysoTokenManager();
        if (mysoTokenManager != address(0)) {
            applicableProtocolFeeParams = IMysoTokenManager(mysoTokenManager)
                .processP2PBorrow(
                    applicableProtocolFeeParams,
                    borrowInstructions,
                    loan,
                    lenderVault
                );
            for (uint256 i; i < 2; ) {
                if (applicableProtocolFeeParams[i] > currProtocolFeeParams[i]) {
                    revert Errors.InvalidFee();
                }
                unchecked {
                    ++i;
                }
            }
        }

        // protocol fees on whole sendAmount
        // protocol fees are embedded with expected transfer fee in borrowInstructions
        // for a full breakdown of how all fee cases are handled, see gitbook
        // myso-v2-docs p2p-borrowing-and-lending -> fee-mechanics
        uint256 protocolFeeAmount = _calculateProtocolFeeAmount(
            applicableProtocolFeeParams,
            borrowInstructions.collSendAmount,
            loan.initCollAmount == 0 ? 0 : loan.expiry - block.timestamp
        );

        // check protocolFeeAmount <= expectedTransferFee
        if (protocolFeeAmount > borrowInstructions.expectedTransferFee) {
            revert Errors.InsufficientSendAmount();
        }

        if (protocolFeeAmount != 0) {
            // note: if coll token has a transfer fee, then protocolFeeAmount will be slightly reduced
            // this is by design since the protocol can choose to not whitelist the token with a transfer fee
            // and this avoids borrower or lender feeling aggrieved by paying extra fee to protocol
            IERC20Metadata(loan.collToken).safeTransferFrom(
                loan.borrower,
                registry.owner(),
                protocolFeeAmount
            );
        }

        uint256 collReceiverPreBal = IERC20Metadata(loan.collToken).balanceOf(
            transferInstructions.collReceiver
        );

        uint256 collReceiverTransferAmount = borrowInstructions.collSendAmount -
            protocolFeeAmount;
        uint256 collReceiverExpBalDiff = loan.initCollAmount +
            transferInstructions.upfrontFee;
        if (
            transferInstructions.collReceiver != lenderVault &&
            transferInstructions.upfrontFee != 0
        ) {
            collReceiverTransferAmount -= (transferInstructions.upfrontFee +
                borrowInstructions.expectedUpfrontFeeToVaultTransferFee);
            collReceiverExpBalDiff -= transferInstructions.upfrontFee;
            // Note: if a compartment is used then we need to transfer the upfront fee to the vault separately;
            // in the special case where the coll also has a token transfer fee then the vault transfer fee of upfront
            // fee to vault needs to be added here to account for loss of coll token due to transfer fee.
            uint256 vaultPreBal = IERC20Metadata(loan.collToken).balanceOf(
                lenderVault
            );
            IERC20Metadata(loan.collToken).safeTransferFrom(
                loan.borrower,
                lenderVault,
                transferInstructions.upfrontFee +
                    borrowInstructions.expectedUpfrontFeeToVaultTransferFee
            );
            if (
                IERC20Metadata(loan.collToken).balanceOf(lenderVault) !=
                vaultPreBal + transferInstructions.upfrontFee
            ) {
                revert Errors.InvalidSendAmount();
            }
        }
        IERC20Metadata(loan.collToken).safeTransferFrom(
            loan.borrower,
            transferInstructions.collReceiver,
            collReceiverTransferAmount
        );
        if (
            IERC20Metadata(loan.collToken).balanceOf(
                transferInstructions.collReceiver
            ) != collReceiverExpBalDiff + collReceiverPreBal
        ) {
            revert Errors.InvalidSendAmount();
        }
    }

    function _processRepayTransfers(
        address lenderVault,
        DataTypesPeerToPeer.LoanRepayInstructions memory loanRepayInstructions,
        DataTypesPeerToPeer.Loan memory loan,
        uint128 leftRepaymentAmount,
        uint128 reclaimCollAmount,
        bool noCompartment
    ) internal {
        noCompartment
            ? ILenderVaultImpl(lenderVault).transferTo(
                loan.collToken,
                loanRepayInstructions.callbackAddr == address(0)
                    ? loan.borrower
                    : loanRepayInstructions.callbackAddr,
                reclaimCollAmount
            )
            : ILenderVaultImpl(lenderVault).transferCollFromCompartment(
                loanRepayInstructions.targetRepayAmount,
                leftRepaymentAmount,
                reclaimCollAmount,
                loan.borrower,
                loan.collToken,
                loanRepayInstructions.callbackAddr,
                loan.collTokenCompartmentAddr
            );
        if (loanRepayInstructions.callbackAddr != address(0)) {
            IVaultCallback(loanRepayInstructions.callbackAddr).repayCallback(
                loan,
                loanRepayInstructions.callbackData
            );
        }
        uint256 loanTokenReceived = IERC20Metadata(loan.loanToken).balanceOf(
            lenderVault
        );

        IERC20Metadata(loan.loanToken).safeTransferFrom(
            loan.borrower,
            lenderVault,
            loanRepayInstructions.targetRepayAmount +
                loanRepayInstructions.expectedTransferFee
        );

        loanTokenReceived =
            IERC20Metadata(loan.loanToken).balanceOf(lenderVault) -
            loanTokenReceived;
        if (loanTokenReceived != loanRepayInstructions.targetRepayAmount) {
            revert Errors.InvalidSendAmount();
        }
    }

    function _checkDeadlineAndRegisteredVault(
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

    function _calculateProtocolFeeAmount(
        uint256[2] memory _protocolFeeParams,
        uint256 collSendAmount,
        uint256 borrowDuration
    ) internal pure returns (uint256 protocolFeeAmount) {
        protocolFeeAmount =
            (_protocolFeeParams[0] * collSendAmount) /
            Constants.BASE;
        uint256 additionalLoanProtocolFee = (collSendAmount *
            (
                borrowDuration > Constants.MAX_TIME_BEFORE_PROTOCOL_FEE_CAP
                    ? _protocolFeeParams[1] *
                        Constants.MAX_TIME_BEFORE_PROTOCOL_FEE_CAP
                    : _protocolFeeParams[1] * borrowDuration
            )) / (Constants.BASE * Constants.YEAR_IN_SECONDS);
        protocolFeeAmount += additionalLoanProtocolFee;
    }
}
