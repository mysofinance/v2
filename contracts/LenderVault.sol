// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IVaultCallback} from "./interfaces/IVaultCallback.sol";
import {ICompartmentFactory} from "./interfaces/ICompartmentFactory.sol";
import {ICompartment} from "./interfaces/ICompartment.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {IAutoQuoteStrategy} from "./interfaces/IAutoQuoteStrategy.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {DataTypes} from "./DataTypes.sol";

contract LenderVault is ReentrancyGuard, Initializable {
    using SafeERC20 for IERC20Metadata;

    uint256 constant BASE = 1e18;
    address vaultOwner;
    address addressRegistry;

    mapping(address => uint256) public lockedAmounts;
    mapping(bytes32 => bool) isConsumedQuote;
    mapping(bytes32 => bool) public isOnChainQuote;
    mapping(address => mapping(address => address)) public autoQuoteStrategy; // points to auto loan strategy for given coll/loan token pair
    // for now remove public getter for byte code size purposes...
    // todo: check if this is needed mapping(address => address) collTokenImplAddrs;
    DataTypes.Loan[] public loans; // stores loans

    uint256 loanOffChainQuoteNonce;
    address compartmentFactory;

    /*
    can remove ILendingPool because also interest bearing tokens can be deposited 
    by virtue of simple transfer; e.g. lender can also deposit an atoken and allow
    borrowers to directly borrow the atoken; the repayment amount could then also be
    set to be atoken such that on repayment any idle funds automatically continue earning
    yield
    */

    error Invalid();

    event OnChainQuote(
        DataTypes.OnChainQuote onChainQuote,
        bytes32 onChainQuoteHash,
        bool isActive
    );

    function initialize(
        address _vaultOwner,
        address _addressRegistry,
        address _compartmentFactory
    ) external initializer {
        vaultOwner = _vaultOwner;
        addressRegistry = _addressRegistry;
        compartmentFactory = _compartmentFactory;
        loanOffChainQuoteNonce = 1;
    }

    function invalidateOffChainQuoteNonce() external {
        senderCheck();
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
        if (msg.sender != IAddressRegistry(addressRegistry).borrowerGateway()) {
            revert();
        }
        IERC20Metadata(token).safeTransfer(recipient, amount);
    }

    function setAutoQuoteStrategy(
        address collToken,
        address loanToken,
        address strategyAddr
    ) external {
        senderCheck();
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
        loan.loanToken = onChainQuote.loanToken;
        loan.collToken = onChainQuote.collToken;
        loan.initCollAmount = toUint128(collSendAmount - upfrontFee);
        loan.initLoanAmount = toUint128(loanAmount);
        loan.initRepayAmount = toUint128(repayAmount);
        loan.expiry = uint40(block.timestamp + onChainQuote.tenor);
        loan.earliestRepay = uint40(
            block.timestamp + onChainQuote.timeUntilEarliestRepay
        );
    }

    function getLoanInfoForOffChainQuote(
        address borrower,
        DataTypes.OffChainQuote calldata offChainQuote
    ) external pure returns (DataTypes.Loan memory loan, uint256 upfrontFee) {
        loan.borrower = borrower;
        loan.loanToken = offChainQuote.loanToken;
        loan.collToken = offChainQuote.collToken;
        loan.initCollAmount = toUint128(offChainQuote.collAmount);
        loan.initLoanAmount = toUint128(offChainQuote.loanAmount);
        loan.initRepayAmount = toUint128(offChainQuote.repayAmount);
        loan.expiry = uint40(offChainQuote.expiry);
        loan.earliestRepay = uint40(offChainQuote.earliestRepay);
        upfrontFee = offChainQuote.upfrontFee;
    }

    function addLoan(DataTypes.Loan calldata loan) external {
        if (msg.sender != IAddressRegistry(addressRegistry).borrowerGateway()) {
            revert();
        }
        loans.push(loan);
    }

    function withdraw(address token, uint256 amount) external {
        senderCheck();
        uint256 vaultBalance = IERC20Metadata(token).balanceOf(address(this));
        if (amount > vaultBalance - lockedAmounts[token]) {
            revert Invalid();
        }
        IERC20Metadata(token).safeTransfer(vaultOwner, amount);
    }

    function addOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        senderCheck();
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
        senderCheck();
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
        senderCheck();
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
                offChainQuote.useCollCompartment,
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
            DataTypes.Loan storage loan = loans[_loanIds[i]];
            if (loan.collToken != collToken) {
                revert();
            }
            if (!loan.collUnlocked && block.timestamp >= loan.expiry) {
                if (loan.hasCollCompartment) {
                    ICompartment(loan.collTokenCompartmentAddr)
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
                onChainQuote.collToken,
                onChainQuote.loanToken,
                onChainQuote.tenor,
                onChainQuote.timeUntilEarliestRepay,
                onChainQuote.isNegativeInterestRate,
                onChainQuote.useCollCompartment
            )
        );
    }

    function senderCheck() internal view {
        if (msg.sender != vaultOwner) {
            revert Invalid();
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
}
