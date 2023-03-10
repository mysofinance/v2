// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {IBorrowerCompartment} from "./interfaces/IBorrowerCompartment.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {IVaultCallback} from "./interfaces/IVaultCallback.sol";
import {DataTypes} from "./DataTypes.sol";

contract LenderVault is ReentrancyGuard, Initializable, ILenderVault {
    using SafeERC20 for IERC20Metadata;

    uint256 constant BASE = 1e18;
    address public vaultOwner;
    address public newVaultOwner;
    address public addressRegistry;
    address[] public signers;
    uint256 public minNumOfSigners;
    mapping(address => bool) public isSigner;

    mapping(address => uint256) public lockedAmounts;
    DataTypes.Loan[] _loans; // stores loans

    error Invalid();
    error InvalidLoanIndex();

    function initialize(
        address _vaultOwner,
        address _addressRegistry
    ) external initializer {
        vaultOwner = _vaultOwner;
        addressRegistry = _addressRegistry;
        minNumOfSigners = 1;
    }

    function proposeNewVaultOwner(address _newOwner) external {
        senderCheckOwner();
        newVaultOwner = _newOwner;
    }

    function claimVaultOwnership() external {
        if (msg.sender != newVaultOwner) {
            revert Invalid();
        }
        vaultOwner = newVaultOwner;
    }

    function addSigners(address[] calldata _signers) external {
        senderCheckOwner();
        for (uint256 i = 0; i < _signers.length; ) {
            if (isSigner[_signers[i]]) {
                revert();
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
            revert();
        }

        if (!isSigner[signer] || signer != signers[signerIdx]) {
            revert();
        }
        signers[signerIdx] = signers[signersLen - 1];
        signers.pop();
        isSigner[signer] = false;
    }

    function setMinNumOfSigners(uint256 _minNumOfSigners) external {
        senderCheckOwner();
        if (_minNumOfSigners == 0) {
            revert();
        }
        minNumOfSigners = _minNumOfSigners;
    }

    function loans(
        uint256 loanId
    ) external view returns (DataTypes.Loan memory loan) {
        uint256 loanLen = _loans.length;
        if (loanLen == 0 || loanId > loanLen - 1) {
            revert InvalidLoanIndex();
        }
        loan = _loans[loanId];
    }

    function transferTo(
        address token,
        address recipient,
        uint256 amount
    ) external {
        senderCheckGateway();
        IERC20Metadata(token).safeTransfer(recipient, amount);
    }

    function transferFromCompartment(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr,
        address collTokenCompartmentAddr
    ) external {
        senderCheckGateway();
        IBorrowerCompartment(collTokenCompartmentAddr)
            .transferCollFromCompartment(
                repayAmount,
                repayAmountLeft,
                borrowerAddr,
                collTokenAddr,
                callbackAddr
            );
    }

    function validateRepayInfo(
        address borrower,
        DataTypes.Loan memory loan,
        DataTypes.LoanRepayInfo memory loanRepayInfo
    ) external view {
        if (borrower != loan.borrower) {
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
        uint256 collSendAmount,
        uint256 expectedTransferFee,
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
        upfrontFee = (collSendAmount * quoteTuple.upfrontFeePctInBase) / BASE;
        if (collSendAmount < upfrontFee + expectedTransferFee) {
            revert(); // InsufficientSendAmount();
        }
        (uint256 loanAmount, uint256 repayAmount) = getLoanAndRepayAmount(
            collSendAmount,
            expectedTransferFee,
            generalQuoteInfo,
            quoteTuple
        );
        // checks to prevent griefing attacks (e.g. small unlocks that aren't worth it)
        if (
            loanAmount < generalQuoteInfo.minLoan ||
            loanAmount > generalQuoteInfo.maxLoan
        ) {
            revert(); // revert InsufficientSendAmount();
        }

        loan.borrower = borrower;
        loan.loanToken = generalQuoteInfo.loanToken;
        loan.collToken = generalQuoteInfo.collToken;
        loan.initCollAmount = toUint128(
            collSendAmount - upfrontFee - expectedTransferFee
        );
        loan.initLoanAmount = toUint128(loanAmount);
        loan.initRepayAmount = toUint128(repayAmount);
        loan.expiry = uint40(block.timestamp + quoteTuple.tenor);
        loan.earliestRepay = uint40(
            block.timestamp + generalQuoteInfo.earliestRepayTenor
        );
        if (loan.expiry <= loan.earliestRepay) {
            revert();
        }

        if (generalQuoteInfo.borrowerCompartmentImplementation == address(0)) {
            collReceiver = address(this);
            lockedAmounts[loan.collToken] += loan.initCollAmount;
        } else {
            collReceiver = createCollCompartment(
                generalQuoteInfo.borrowerCompartmentImplementation,
                borrower,
                generalQuoteInfo.collToken,
                _loans.length
            );
            loan.collTokenCompartmentAddr = collReceiver;
        }
        loanId = _loans.length;
        _loans.push(loan);
    }

    function withdraw(address token, uint256 amount) external {
        senderCheckOwner();
        uint256 vaultBalance = IERC20Metadata(token).balanceOf(address(this));
        if (amount > vaultBalance - lockedAmounts[token]) {
            revert Invalid();
        }
        IERC20Metadata(token).safeTransfer(vaultOwner, amount);
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
                revert();
            }
            if (!loan.collUnlocked && block.timestamp >= loan.expiry) {
                if (loan.collTokenCompartmentAddr != address(0)) {
                    IBorrowerCompartment(loan.collTokenCompartmentAddr)
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
                vaultOwner,
                currentCollTokenBalance - lockedAmounts[collToken]
            );
        }
    }

    function createCollCompartment(
        address borrowerCompartmentImplementation,
        address borrower,
        address collToken,
        uint256 loanId
    ) internal returns (address collCompartment) {
        if (
            IAddressRegistry(addressRegistry).isWhitelistedCollTokenHandler(
                borrowerCompartmentImplementation
            )
        ) {
            revert();
        }
        bytes32 salt = keccak256(
            abi.encodePacked(
                borrowerCompartmentImplementation,
                address(this),
                borrower,
                loanId
            )
        );
        collCompartment = Clones.cloneDeterministic(
            borrowerCompartmentImplementation,
            salt
        );
        IBorrowerCompartment(collCompartment).initialize(
            address(this),
            borrower,
            collToken,
            loanId
        );
    }

    function senderCheckOwner() internal view {
        if (msg.sender != vaultOwner) {
            revert Invalid();
        }
    }

    function senderCheckGateway() internal view {
        if (msg.sender != IAddressRegistry(addressRegistry).borrowerGateway()) {
            revert();
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
                revert();
            }
            // arbitrage protection...any reason with a callback and
            // purpose-bound loan might want greater than 100%?
            if (quoteTuple.loanPerCollUnitOrLtv > BASE) {
                revert();
            }
            loanPerCollUnit =
                (quoteTuple.loanPerCollUnitOrLtv *
                    IOracle(generalQuoteInfo.oracleAddr).getPrice(
                        generalQuoteInfo.collToken,
                        generalQuoteInfo.loanToken
                    )) /
                BASE;
        }
        loanAmount =
            (loanPerCollUnit * (collSendAmount - expectedTransferFee)) /
            (10 ** IERC20Metadata(generalQuoteInfo.collToken).decimals());
        uint256 vaultLoanTokenBal = IERC20(generalQuoteInfo.loanToken)
            .balanceOf(address(this));
        // check if loan is too big for vault
        if (loanAmount > vaultLoanTokenBal) {
            revert(); // InsufficientVaultFunds();
        }
        int256 _interestRateFactor = int256(BASE) +
            quoteTuple.interestRatePctInBase;
        if (_interestRateFactor < 0) {
            revert();
        }
        uint256 interestRateFactor = uint256(_interestRateFactor);
        repayAmount = (loanAmount * interestRateFactor) / BASE;
    }

    function toUint128(uint256 x) internal pure returns (uint128 y) {
        y = uint128(x);
        if (y != x) {
            revert();
        }
    }
}
