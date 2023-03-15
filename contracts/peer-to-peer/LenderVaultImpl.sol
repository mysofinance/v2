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

contract LenderVaultImpl is Initializable, Ownable, ILenderVaultImpl {
    using SafeERC20 for IERC20Metadata;

    address public addressRegistry;
    address[] public signers;
    uint256 public minNumOfSigners;
    mapping(address => bool) public isSigner;
    bool public withdrawEntered;

    mapping(address => uint256) public lockedAmounts;
    DataTypes.Loan[] public _loans; // stores loans

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
            DataTypes.Loan storage loan = _loans[_loanIds[i]];

            if (loan.collToken != collToken) {
                revert Errors.InconsistentUnlockTokenAddresses();
            }
            if (!loan.collUnlocked && block.timestamp >= loan.expiry) {
                if (loan.collTokenCompartmentAddr != address(0)) {
                    IBaseCompartment(loan.collTokenCompartmentAddr)
                        .unlockCollToVault(loan.collToken);
                } else {
                    tmp =
                        loan.initCollAmount -
                        (loan.initCollAmount * loan.amountRepaidSoFar) /
                        loan.initRepayAmount;
                    totalUnlockableColl += tmp;
                }
            }
            loan.collUnlocked = true;
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
    }

    function updateLoanInfo(
        DataTypes.Loan memory loan,
        uint128 repayAmount,
        uint256 loanId,
        uint256 collAmount,
        bool isRepay
    ) external {
        senderCheckGateway();
        if (isRepay) {
            loan.amountRepaidSoFar += repayAmount;
        }

        // only update lockedAmounts when no compartment
        if (loan.collTokenCompartmentAddr == address(0)) {
            if (isRepay) {
                lockedAmounts[loan.collToken] -= collAmount;
            } else {
                lockedAmounts[loan.collToken] += collAmount;
            }
        }
        if (isRepay || loan.collTokenCompartmentAddr != address(0)) {
            _loans[loanId] = loan;
        }
    }

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

        loan.borrower = borrower;
        loan.loanToken = generalQuoteInfo.loanToken;
        loan.collToken = generalQuoteInfo.collToken;
        loan.initCollAmount = toUint128(
            borrowInstructions.collSendAmount -
                upfrontFee -
                borrowInstructions.expectedTransferFee
        );
        loan.initLoanAmount = toUint128(loanAmount);
        loan.initRepayAmount = toUint128(repayAmount);
        loan.expiry = uint40(block.timestamp + quoteTuple.tenor);
        loan.earliestRepay = uint40(
            block.timestamp + generalQuoteInfo.earliestRepayTenor
        );
        if (loan.expiry <= loan.earliestRepay) {
            revert Errors.ExpiresBeforeRepayAllowed();
        }

        if (generalQuoteInfo.borrowerCompartmentImplementation == address(0)) {
            collReceiver = address(this);
            lockedAmounts[loan.collToken] += loan.initCollAmount;
        } else {
            collReceiver = createCollCompartment(
                generalQuoteInfo.borrowerCompartmentImplementation,
                _loans.length
            );
            loan.collTokenCompartmentAddr = collReceiver;
        }
        loanId = _loans.length;
        _loans.push(loan);
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
        signers[signerIdx] = signers[signersLen - 1];
        signers.pop();
        isSigner[signer] = false;
    }

    function loans(
        uint256 loanId
    ) external view returns (DataTypes.Loan memory loan) {
        uint256 loanLen = _loans.length;
        if (loanLen == 0 || loanId > loanLen - 1) {
            revert Errors.InvalidArrayIndex();
        }
        loan = _loans[loanId];
    }

    function validateRepayInfo(
        address borrower,
        DataTypes.Loan memory loan,
        DataTypes.LoanRepayInstructions memory loanRepayInstructions
    ) external view {
        if (borrower != loan.borrower) {
            revert Errors.InvalidBorrower();
        }
        if (
            block.timestamp < loan.earliestRepay ||
            block.timestamp >= loan.expiry
        ) {
            revert Errors.OutsideValidRepayWindow();
        }
        if (
            loanRepayInstructions.targetRepayAmount >
            loan.initRepayAmount - loan.amountRepaidSoFar
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
            IAddressRegistry(addressRegistry).isWhitelistedCollTokenHandler(
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
