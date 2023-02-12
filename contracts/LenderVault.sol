// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {IAutoQuoteStrategy} from "./interfaces/IAutoQuoteStrategy.sol";
import {IBorrowerCompartment} from "./interfaces/IBorrowerCompartment.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {IVaultCallback} from "./interfaces/IVaultCallback.sol";
import {DataTypes} from "./DataTypes.sol";

contract LenderVault is ReentrancyGuard, Initializable, ILenderVault {
    using SafeERC20 for IERC20Metadata;

    uint256 constant BASE = 1e18;
    address public vaultOwner;
    address public newVaultOwner;
    address public addressRegistry;

    mapping(address => uint256) public lockedAmounts;
    mapping(bytes32 => bool) isConsumedQuote;
    mapping(bytes32 => bool) public isOnChainQuote;
    mapping(address => mapping(address => address)) public autoQuoteStrategy; // points to auto loan strategy for given coll/loan token pair
    // for now remove public getter for byte code size purposes...
    // todo: check if this is needed mapping(address => address) collTokenImplAddrs;
    DataTypes.Loan[] _loans; // stores loans

    uint256 loanOffChainQuoteNonce;

    error Invalid();
    error InvalidLoanIndex();

    event OnChainQuote(
        DataTypes.OnChainQuote onChainQuote,
        bytes32 onChainQuoteHash,
        bool isActive
    );

    function initialize(
        address _vaultOwner,
        address _addressRegistry
    ) external initializer {
        vaultOwner = _vaultOwner;
        addressRegistry = _addressRegistry;
        loanOffChainQuoteNonce = 1;
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

    function loans(
        uint256 loanId
    ) external view returns (DataTypes.Loan memory loan) {
        uint256 loanLen = _loans.length;
        if (loanLen == 0 || loanId > loanLen - 1) {
            revert InvalidLoanIndex();
        }
        loan = _loans[loanId];
    }

    function invalidateOffChainQuoteNonce() external {
        senderCheckOwner();
        loanOffChainQuoteNonce += 1;
    }

    function invalidateOffChainQuote(bytes32 offChainQuoteHash) external {
        if (
            (msg.sender != vaultOwner &&
                msg.sender !=
                IAddressRegistry(addressRegistry).borrowerGateway()) ||
            isConsumedQuote[offChainQuoteHash]
        ) {
            revert();
        }
        isConsumedQuote[offChainQuoteHash] = true;
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
        uint256 repayAmount,
        uint256 loanId,
        uint256 collAmount,
        bool isRepay
    ) external {
        senderCheckGateway();
        if (isRepay) {
            loan.amountRepaidSoFar += toUint128(repayAmount);
        }

        // only update lockedAmounts when no compartment
        if (loan.collTokenCompartmentAddr != address(0)) {
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

    function setAutoQuoteStrategy(
        address collToken,
        address loanToken,
        address strategyAddr
    ) external {
        senderCheckOwner();
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedAutoQuoteStrategy(
                strategyAddr
            )
        ) {
            revert();
        }
        autoQuoteStrategy[collToken][loanToken] = strategyAddr;
    }

    function getLoanInfoForOnChainQuote(
        address borrower,
        uint256 collSendAmount,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external view returns (DataTypes.Loan memory loan, uint256 upfrontFee) {
        loan.borrower = borrower;
        uint256 loanAmount = (onChainQuote.loanPerCollUnit * collSendAmount) /
            (10 ** IERC20Metadata(onChainQuote.collToken).decimals());
        uint256 repayAmount;
        if (onChainQuote.isNegativeInterestRate) {
            repayAmount =
                (loanAmount * (BASE - onChainQuote.interestRatePctInBase)) /
                BASE;
        } else {
            repayAmount =
                (loanAmount * (BASE + onChainQuote.interestRatePctInBase)) /
                BASE;
        }
        upfrontFee = (collSendAmount * onChainQuote.upfrontFeePctInBase) / BASE;
        // minimum coll amount to prevent griefing attacks or small unlocks that aren't worth it
        if (
            collSendAmount - upfrontFee - onChainQuote.expectedTransferFee <
            onChainQuote.minCollAmount
        ) {
            revert(); // revert InsufficientCollAmount();
        }
        loan.loanToken = onChainQuote.loanToken;
        loan.collToken = onChainQuote.collToken;
        loan.initCollAmount = toUint128(
            collSendAmount - upfrontFee - onChainQuote.expectedTransferFee
        );
        loan.initLoanAmount = toUint128(loanAmount);
        loan.initRepayAmount = toUint128(repayAmount);
        loan.expiry = uint40(block.timestamp + onChainQuote.tenor);
        loan.earliestRepay = uint40(
            block.timestamp + onChainQuote.timeUntilEarliestRepay
        );
        if (onChainQuote.borrowerCompartmentImplementation != address(0)) {
            loan = setCompartmentLoanData(
                onChainQuote.borrowerCompartmentImplementation,
                borrower,
                loan
            );
        }
    }

    function getLoanInfoForOffChainQuote(
        address borrower,
        DataTypes.OffChainQuote calldata offChainQuote
    ) external view returns (DataTypes.Loan memory loan, uint256 upfrontFee) {
        loan.borrower = borrower;
        loan.loanToken = offChainQuote.loanToken;
        loan.collToken = offChainQuote.collToken;
        loan.initCollAmount = toUint128(offChainQuote.collAmount);
        loan.initLoanAmount = toUint128(offChainQuote.loanAmount);
        loan.initRepayAmount = toUint128(offChainQuote.repayAmount);
        loan.expiry = uint40(offChainQuote.expiry);
        loan.earliestRepay = uint40(offChainQuote.earliestRepay);
        upfrontFee = offChainQuote.upfrontFee;
        if (offChainQuote.borrowerCompartmentImplementation != address(0)) {
            loan = setCompartmentLoanData(
                offChainQuote.borrowerCompartmentImplementation,
                borrower,
                loan
            );
        }
    }

    function addLoan(
        DataTypes.Loan calldata loan
    ) external returns (uint256 loanId) {
        senderCheckGateway();
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

    function addOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        senderCheckOwner();
        if (!isValidOnChainQuote(onChainQuote)) {
            revert Invalid();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (isOnChainQuote[onChainQuoteHash]) {
            revert Invalid();
        }
        isOnChainQuote[onChainQuoteHash] = true;
        emit OnChainQuote(onChainQuote, onChainQuoteHash, true);
    }

    function updateOnChainQuote(
        DataTypes.OnChainQuote calldata oldOnChainQuote,
        DataTypes.OnChainQuote calldata newOnChainQuote
    ) external {
        senderCheckOwner();
        if (!isValidOnChainQuote(newOnChainQuote)) {
            revert Invalid();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(oldOnChainQuote);
        if (isOnChainQuote[onChainQuoteHash]) {
            revert Invalid();
        }
        isOnChainQuote[onChainQuoteHash] = false;
        emit OnChainQuote(oldOnChainQuote, onChainQuoteHash, false);
        onChainQuoteHash = hashOnChainQuote(newOnChainQuote);
        isOnChainQuote[onChainQuoteHash] = true;
        emit OnChainQuote(newOnChainQuote, onChainQuoteHash, true);
    }

    function deleteOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        senderCheckOwner();
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (!isOnChainQuote[onChainQuoteHash]) {
            revert Invalid();
        }
        isOnChainQuote[onChainQuoteHash] = false;
        emit OnChainQuote(onChainQuote, onChainQuoteHash, false);
    }

    function doesAcceptOnChainQuote(
        DataTypes.OnChainQuote memory onChainQuote
    ) external view returns (bool) {
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                onChainQuote.collToken,
                onChainQuote.loanToken
            )
        ) {
            return false;
        }
        return isOnChainQuote[hashOnChainQuote(onChainQuote)];
    }

    function doesAcceptAutoQuote(
        DataTypes.OnChainQuote memory onChainQuote
    ) external view returns (bool) {
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                onChainQuote.collToken,
                onChainQuote.loanToken
            )
        ) {
            return false;
        }
        return
            autoQuoteStrategy[onChainQuote.collToken][onChainQuote.loanToken] !=
            address(0);
    }

    function doesAcceptOffChainQuote(
        address borrower,
        DataTypes.OffChainQuote calldata offChainQuote
    ) external view returns (bool doesAccept, bytes32 offChainQuoteHash) {
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                offChainQuote.collToken,
                offChainQuote.loanToken
            )
        ) {
            doesAccept = false;
        }
        offChainQuoteHash = keccak256(
            abi.encode(
                offChainQuote.borrower,
                offChainQuote.collToken,
                offChainQuote.loanToken,
                offChainQuote.collAmount,
                offChainQuote.loanAmount,
                offChainQuote.expiry,
                offChainQuote.earliestRepay,
                offChainQuote.repayAmount,
                offChainQuote.validUntil,
                offChainQuote.upfrontFee,
                offChainQuote.borrowerCompartmentImplementation,
                offChainQuote.nonce
            )
        );
        if (
            isConsumedQuote[offChainQuoteHash] ||
            offChainQuote.nonce >= loanOffChainQuoteNonce
        ) {
            doesAccept = false;
        }
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                offChainQuoteHash
            )
        );
        address signer = ecrecover(
            messageHash,
            offChainQuote.v,
            offChainQuote.r,
            offChainQuote.s
        );

        if (
            signer != vaultOwner || offChainQuote.validUntil < block.timestamp
        ) {
            doesAccept = false;
        }
        if (borrower == address(0) || borrower != offChainQuote.borrower) {
            doesAccept = false;
        }
        doesAccept = true;
    }

    function unlockCollateral(
        address collToken,
        uint256[] calldata _loanIds
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
        uint256 currentCollTokenBalance = IERC20Metadata(collToken).balanceOf(
            address(this)
        );
        IERC20Metadata(collToken).safeTransfer(
            vaultOwner,
            currentCollTokenBalance - lockedAmounts[collToken]
        );
    }

    function hashOnChainQuote(
        DataTypes.OnChainQuote memory onChainQuote
    ) internal pure returns (bytes32 onChainQuoteHash) {
        onChainQuoteHash = keccak256(
            abi.encode(
                onChainQuote.loanPerCollUnit,
                onChainQuote.interestRatePctInBase,
                onChainQuote.upfrontFeePctInBase,
                onChainQuote.expectedTransferFee,
                onChainQuote.minCollAmount,
                onChainQuote.collToken,
                onChainQuote.loanToken,
                onChainQuote.tenor,
                onChainQuote.timeUntilEarliestRepay,
                onChainQuote.isNegativeInterestRate,
                onChainQuote.borrowerCompartmentImplementation
            )
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

    function toUint128(uint256 x) internal pure returns (uint128 y) {
        y = uint128(x);
        if (y != x) {
            revert Invalid();
        }
    }

    function isValidOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote
    ) internal pure returns (bool isValid) {
        isValid = !(onChainQuote.collToken == onChainQuote.loanToken ||
            onChainQuote.timeUntilEarliestRepay > onChainQuote.tenor ||
            (onChainQuote.isNegativeInterestRate &&
                onChainQuote.interestRatePctInBase > BASE) ||
            onChainQuote.upfrontFeePctInBase > BASE);
    }

    function setCompartmentLoanData(
        address borrowerCompartmentImplementation,
        address borrower,
        DataTypes.Loan memory loan
    ) internal view returns (DataTypes.Loan memory) {
        bytes32 salt = keccak256(
            abi.encodePacked(
                borrowerCompartmentImplementation,
                address(this),
                borrower,
                _loans.length
            )
        );
        loan.collTokenCompartmentAddr = Clones.predictDeterministicAddress(
            borrowerCompartmentImplementation,
            salt,
            IAddressRegistry(addressRegistry).borrowerCompartmentFactory()
        );
        return loan;
    }
}
