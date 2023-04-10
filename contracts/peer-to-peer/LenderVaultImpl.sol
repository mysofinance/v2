// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IERC20Metadata, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Constants} from "../Constants.sol";
import {DataTypesPeerToPeer} from "./DataTypesPeerToPeer.sol";
import {Errors} from "../Errors.sol";
import {Helpers} from "../Helpers.sol";
import {Ownable} from "../Ownable.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {IBaseCompartment} from "./interfaces/compartments/IBaseCompartment.sol";
import {ILenderVaultImpl} from "./interfaces/ILenderVaultImpl.sol";
import {IOracle} from "./interfaces/IOracle.sol";

/**
 * @title LenderVaultImpl
 * @notice This contract implements the logic for the Lender Vault.
 * IMPORTANT: Security best practices dictate that the signers should always take care to
 * keep their private keys safe. Signing only trusted and human-readable public schema data is a good practice. Additionally,
 * the Myso team recommends that the signer should use a purpose-bound address for signing to reduce the chance
 * for a compromised private key to result in loss of funds. The Myso team also recommends that even vaults owned
 * by an EOA should have multiple signers to reduce chance of forged quotes. In the event that a signer is compromised,
 * the vault owner should immediately remove the compromised signer and if possible, add a new signer.
 */
contract LenderVaultImpl is Initializable, Ownable, ILenderVaultImpl {
    using SafeERC20 for IERC20Metadata;

    address public addressRegistry;
    address[] public signers;
    uint256 public minNumOfSigners;
    mapping(address => bool) public isSigner;
    bool public withdrawEntered;

    mapping(address => uint256) public lockedAmounts;
    DataTypesPeerToPeer.Loan[] internal _loans; // stores loans

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
        // only owner can call this function
        if (msg.sender != _owner) {
            revert Errors.InvalidSender();
        }
        // if empty array is passed, revert
        if (_loanIds.length == 0) {
            revert Errors.InvalidArrayLength();
        }
        uint256 totalUnlockableColl;
        for (uint256 i = 0; i < _loanIds.length; ) {
            uint256 tmp = 0;
            DataTypesPeerToPeer.Loan storage _loan = _loans[_loanIds[i]];

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
        // if collToken is not used by vault as loan token, then
        // vault owner may have wanted to leave unlocked coll in vault
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
        DataTypesPeerToPeer.Loan memory _loan,
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
        DataTypesPeerToPeer.BorrowTransferInstructions
            calldata borrowInstructions,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    )
        external
        returns (
            DataTypesPeerToPeer.Loan memory _loan,
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
        _loan.initCollAmount = Helpers.toUint128(
            borrowInstructions.collSendAmount -
                upfrontFee -
                borrowInstructions.expectedTransferFee
        );
        _loan.initLoanAmount = Helpers.toUint128(loanAmount);
        _loan.initRepayAmount = Helpers.toUint128(repayAmount);
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
        emit QuoteProcessed(borrower, _loan, loanId, collReceiver);
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
        emit Withdrew(token, amount);
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
        if (_minNumOfSigners == 0 || _minNumOfSigners == minNumOfSigners) {
            revert Errors.InvalidNewMinNumOfSigners();
        }
        minNumOfSigners = _minNumOfSigners;
        emit MinNumberOfSignersSet(_minNumOfSigners);
    }

    function addSigners(address[] calldata _signers) external {
        senderCheckOwner();
        for (uint256 i = 0; i < _signers.length; ) {
            if (_signers[i] == address(0)) {
                revert Errors.InvalidAddress();
            }
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
        if (signerIdx >= signersLen) {
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
    ) external view returns (DataTypesPeerToPeer.Loan memory _loan) {
        uint256 loanLen = _loans.length;
        if (loanLen == 0 || loanId > loanLen - 1) {
            revert Errors.InvalidArrayIndex();
        }
        _loan = _loans[loanId];
    }

    function totalNumLoans() external view returns (uint256) {
        return _loans.length;
    }

    function validateRepayInfo(
        address borrower,
        DataTypesPeerToPeer.Loan memory _loan,
        DataTypesPeerToPeer.LoanRepayInstructions memory loanRepayInstructions
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

    function getTokenBalancesAndLockedAmounts(
        address[] memory tokens
    )
        external
        view
        returns (uint256[] memory balances, uint256[] memory _lockedAmounts)
    {
        if (tokens.length == 0) {
            revert Errors.InvalidArrayLength();
        }
        balances = new uint256[](tokens.length);
        _lockedAmounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ) {
            if (
                tokens[i] == address(0) ||
                IAddressRegistry(addressRegistry).whitelistState(tokens[i]) !=
                DataTypesPeerToPeer.WhitelistState.TOKEN
            ) {
                revert Errors.InvalidAddress();
            }
            balances[i] = IERC20Metadata(tokens[i]).balanceOf(address(this));
            _lockedAmounts[i] = lockedAmounts[tokens[i]];
            unchecked {
                ++i;
            }
        }
    }

    function createCollCompartment(
        address borrowerCompartmentImplementation,
        uint256 loanId
    ) internal returns (address collCompartment) {
        if (
            IAddressRegistry(addressRegistry).whitelistState(
                borrowerCompartmentImplementation
            ) != DataTypesPeerToPeer.WhitelistState.COMPARTMENT
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
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    ) internal view returns (uint256 loanAmount, uint256 repayAmount) {
        uint256 loanPerCollUnit;
        if (generalQuoteInfo.oracleAddr == address(0)) {
            loanPerCollUnit = quoteTuple.loanPerCollUnitOrLtv;
        } else {
            if (
                IAddressRegistry(addressRegistry).whitelistState(
                    generalQuoteInfo.oracleAddr
                ) != DataTypesPeerToPeer.WhitelistState.ORACLE
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
        // check if loan is too big for vault excluding locked funds
        if (
            loanAmount >
            vaultLoanTokenBal - lockedAmounts[generalQuoteInfo.loanToken]
        ) {
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
}
