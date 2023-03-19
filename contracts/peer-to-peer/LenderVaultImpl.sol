// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Constants} from "../Constants.sol";
import {DataTypes} from "./DataTypes.sol";
import {Errors} from "../Errors.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {IBaseCompartment} from "./interfaces/compartments/IBaseCompartment.sol";
import {ILenderVaultImpl} from "./interfaces/ILenderVaultImpl.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {Ownable} from "../Ownable.sol";
import {IEvents} from "./interfaces/IEvents.sol";

contract LenderVaultImpl is Initializable, Ownable, IEvents, ILenderVaultImpl {
    using SafeERC20 for IERC20Metadata;

    address public addressRegistry;
    address[] public signers;
    uint256 public minNumOfSigners;
    mapping(address => bool) public isSigner;
    bool public withdrawEntered;

    mapping(address => uint256) public lockedAmounts;
    DataTypes.Loan[] internal _loans; // stores loans

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _vaultOwner,
        address _addressRegistry
    ) external initializer {
        _owner = _vaultOwner;
        addressRegistry = _addressRegistry;
        minNumOfSigners = 1;
    }

    function unlockCollateral(
        address collToken,
        uint256[] calldata _loanIds,
        bool autoWithdraw
    ) external {
        uint256 totalUnlockableColl;

        for (uint256 i = 0; i < _loanIds.length; ) {
            uint256 tmp = 0;
            DataTypes.Loan storage _loan = _loans[_loanIds[i]];

            if (_loan.collToken != collToken) {
                revert Errors.InconsistentUnlockTokenAddresses();
            }
            if (_loan.collUnlocked || block.timestamp < _loan.expiry) {
                revert Errors.InvalidCollUnlock();
            }
            if (_loan.collTokenCompartmentAddr != address(0)) {
                IBaseCompartment(_loan.collTokenCompartmentAddr)
                    .unlockCollToVault(_loan.collToken);
            } else {
                tmp =
                    _loan.initCollAmount -
                    (_loan.initCollAmount * _loan.amountRepaidSoFar) /
                    _loan.initRepayAmount;
                totalUnlockableColl += tmp;
            }
            _loan.collUnlocked = true;
            unchecked {
                i++;
            }
        }

        lockedAmounts[collToken] -= totalUnlockableColl;
        // if collToken is not used by vault as loan token too
        if (autoWithdraw) {
            uint256 currentCollTokenBalance = IERC20Metadata(collToken)
                .balanceOf(address(this));

            IERC20Metadata(collToken).safeTransfer(
                _owner,
                currentCollTokenBalance - lockedAmounts[collToken]
            );
        }

        emit CollateralUnlocked(_owner, collToken, _loanIds, autoWithdraw);
    }

    function updateLoanInfo(
        DataTypes.Loan memory _loan,
        uint128 repayAmount,
        uint256 loanId,
        uint256 collAmount
    ) external {
        senderCheckGateway();
        _loan.amountRepaidSoFar += repayAmount;

        // only update lockedAmounts when no compartment
        if (_loan.collTokenCompartmentAddr == address(0)) {
            lockedAmounts[_loan.collToken] -= collAmount;
        }
        _loans[loanId] = _loan;
    }

    function processQuote(
        address borrower,
        DataTypes.BorrowTransferInstructions calldata borrowInstructions,
        DataTypes.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypes.QuoteTuple calldata quoteTuple
    )
        external
        returns (
            DataTypes.Loan memory _loan,
            uint256 loanId,
            uint256 upfrontFee,
            address collReceiver
        )
    {
        senderCheckGateway();
        upfrontFee =
            (borrowInstructions.collSendAmount *
                quoteTuple.upfrontFeePctInBase) /
            Constants.BASE;
        if (
            borrowInstructions.collSendAmount <
            upfrontFee + borrowInstructions.expectedTransferFee
        ) {
            revert Errors.InsufficientSendAmount();
        }
        (uint256 loanAmount, uint256 repayAmount) = getLoanAndRepayAmount(
            borrowInstructions.collSendAmount,
            borrowInstructions.expectedTransferFee,
            generalQuoteInfo,
            quoteTuple
        );
        // checks to prevent griefing attacks (e.g. small unlocks that aren't worth it)
        if (
            loanAmount < generalQuoteInfo.minLoan ||
            loanAmount > generalQuoteInfo.maxLoan
        ) {
            revert Errors.InvalidSendAmount();
        }
        if (loanAmount < borrowInstructions.minLoanAmount) {
            revert Errors.TooSmallLoanAmount();
        }

        _loan.borrower = borrower;
        _loan.loanToken = generalQuoteInfo.loanToken;
        _loan.collToken = generalQuoteInfo.collToken;
        _loan.initCollAmount = toUint128(
            borrowInstructions.collSendAmount -
                upfrontFee -
                borrowInstructions.expectedTransferFee
        );
        _loan.initLoanAmount = toUint128(loanAmount);
        _loan.initRepayAmount = toUint128(repayAmount);
        _loan.expiry = uint40(block.timestamp + quoteTuple.tenor);
        _loan.earliestRepay = uint40(
            block.timestamp + generalQuoteInfo.earliestRepayTenor
        );
        if (_loan.expiry <= _loan.earliestRepay) {
            revert Errors.ExpiresBeforeRepayAllowed();
        }

        if (generalQuoteInfo.borrowerCompartmentImplementation == address(0)) {
            collReceiver = address(this);
            lockedAmounts[_loan.collToken] += _loan.initCollAmount;
        } else {
            collReceiver = createCollCompartment(
                generalQuoteInfo.borrowerCompartmentImplementation,
                _loans.length
            );
            _loan.collTokenCompartmentAddr = collReceiver;
        }
        loanId = _loans.length;
        _loans.push(_loan);
    }

    function withdraw(address token, uint256 amount) external {
        if (withdrawEntered) {
            revert Errors.WithdrawEntered();
        }
        withdrawEntered = true;
        senderCheckOwner();
        uint256 vaultBalance = IERC20Metadata(token).balanceOf(address(this));
        if (amount > vaultBalance - lockedAmounts[token]) {
            revert Errors.InvalidWithdrawAmount();
        }
        IERC20Metadata(token).safeTransfer(_owner, amount);
        withdrawEntered = false;
    }

    function transferTo(
        address token,
        address recipient,
        uint256 amount
    ) external {
        senderCheckGateway();
        IERC20Metadata(token).safeTransfer(recipient, amount);
    }

    function transferCollFromCompartment(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr,
        address collTokenCompartmentAddr
    ) external {
        senderCheckGateway();
        IBaseCompartment(collTokenCompartmentAddr).transferCollFromCompartment(
            repayAmount,
            repayAmountLeft,
            borrowerAddr,
            collTokenAddr,
            callbackAddr
        );
    }

    function setMinNumOfSigners(uint256 _minNumOfSigners) external {
        senderCheckOwner();
        if (_minNumOfSigners == 0) {
            revert Errors.MustHaveAtLeastOneSigner();
        }
        minNumOfSigners = _minNumOfSigners;
        emit MinNumberOfSignersSet(_minNumOfSigners);
    }

    function addSigners(address[] calldata _signers) external {
        senderCheckOwner();
        for (uint256 i = 0; i < _signers.length; ) {
            if (isSigner[_signers[i]]) {
                revert Errors.AlreadySigner();
            }
            isSigner[_signers[i]] = true;
            signers.push(_signers[i]);
            unchecked {
                i++;
            }
        }
        emit AddedSigners(_signers);
    }

    function removeSigner(address signer, uint256 signerIdx) external {
        senderCheckOwner();
        uint256 signersLen = signers.length;
        if (signerIdx > signersLen - 1) {
            revert Errors.InvalidArrayIndex();
        }

        if (!isSigner[signer] || signer != signers[signerIdx]) {
            revert Errors.InvalidSignerRemoveInfo();
        }
        address signerMovedFromEnd = signers[signersLen - 1];
        signers[signerIdx] = signerMovedFromEnd;
        signers.pop();
        isSigner[signer] = false;
        emit RemovedSigner(signer, signerIdx, signerMovedFromEnd);
    }

    function loan(
        uint256 loanId
    ) external view returns (DataTypes.Loan memory _loan) {
        uint256 loanLen = _loans.length;
        if (loanLen == 0 || loanId > loanLen - 1) {
            revert Errors.InvalidArrayIndex();
        }
        _loan = _loans[loanId];
    }

    function validateRepayInfo(
        address borrower,
        DataTypes.Loan memory _loan,
        DataTypes.LoanRepayInstructions memory loanRepayInstructions
    ) external view {
        if (borrower != _loan.borrower) {
            revert Errors.InvalidBorrower();
        }
        if (
            block.timestamp < _loan.earliestRepay ||
            block.timestamp >= _loan.expiry
        ) {
            revert Errors.OutsideValidRepayWindow();
        }
        // checks repayAmount <= remaining loan balance
        if (
            loanRepayInstructions.targetRepayAmount >
            _loan.initRepayAmount - _loan.amountRepaidSoFar
        ) {
            revert Errors.InvalidRepayAmount();
        }
    }

    function owner()
        external
        view
        override(Ownable, ILenderVaultImpl)
        returns (address)
    {
        return _owner;
    }

    function createCollCompartment(
        address borrowerCompartmentImplementation,
        uint256 loanId
    ) internal returns (address collCompartment) {
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedCompartmentImpl(
                borrowerCompartmentImplementation
            )
        ) {
            revert Errors.NonWhitelistedCompartment();
        }
        bytes32 salt = keccak256(
            abi.encodePacked(
                borrowerCompartmentImplementation,
                address(this),
                loanId
            )
        );
        collCompartment = Clones.cloneDeterministic(
            borrowerCompartmentImplementation,
            salt
        );
        IBaseCompartment(collCompartment).initialize(address(this), loanId);
    }

    function senderCheckGateway() internal view {
        if (msg.sender != IAddressRegistry(addressRegistry).borrowerGateway()) {
            revert Errors.UnregisteredGateway();
        }
    }

    function getLoanAndRepayAmount(
        uint256 collSendAmount,
        uint256 expectedTransferFee,
        DataTypes.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypes.QuoteTuple calldata quoteTuple
    ) internal view returns (uint256 loanAmount, uint256 repayAmount) {
        uint256 loanPerCollUnit;
        if (generalQuoteInfo.oracleAddr == address(0)) {
            loanPerCollUnit = quoteTuple.loanPerCollUnitOrLtv;
        } else {
            if (
                !IAddressRegistry(addressRegistry).isWhitelistedOracle(
                    generalQuoteInfo.oracleAddr
                )
            ) {
                revert Errors.NonWhitelistedOracle();
            }
            // arbitrage protection...any reason with a callback and
            // purpose-bound loan might want greater than 100%?
            if (quoteTuple.loanPerCollUnitOrLtv > Constants.BASE) {
                revert Errors.LTVHigherThanMax();
            }
            loanPerCollUnit =
                (quoteTuple.loanPerCollUnitOrLtv *
                    IOracle(generalQuoteInfo.oracleAddr).getPrice(
                        generalQuoteInfo.collToken,
                        generalQuoteInfo.loanToken
                    )) /
                Constants.BASE;
        }
        loanAmount =
            (loanPerCollUnit * (collSendAmount - expectedTransferFee)) /
            (10 ** IERC20Metadata(generalQuoteInfo.collToken).decimals());
        uint256 vaultLoanTokenBal = IERC20(generalQuoteInfo.loanToken)
            .balanceOf(address(this));
        // check if loan is too big for vault
        if (loanAmount > vaultLoanTokenBal) {
            revert Errors.InsufficientVaultFunds();
        }
        int256 _interestRateFactor = int256(Constants.BASE) +
            quoteTuple.interestRatePctInBase;
        if (_interestRateFactor < 0) {
            revert Errors.NegativeRepaymentAmount();
        }
        uint256 interestRateFactor = uint256(_interestRateFactor);
        repayAmount = (loanAmount * interestRateFactor) / Constants.BASE;
    }

    function toUint128(uint256 x) internal pure returns (uint128 y) {
        y = uint128(x);
        if (y != x) {
            revert Errors.OverflowUint128();
        }
    }
}
