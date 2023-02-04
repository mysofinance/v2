// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import {IVaultFlashCallback} from "./interfaces/IVaultFlashCallback.sol";
import {ICompartmentFactory} from "./interfaces/ICompartmentFactory.sol";
import {ICompartment} from "./interfaces/ICompartment.sol";
import {DataTypes} from "./DataTypes.sol";

contract LenderVault is ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    uint256 constant BASE = 1e18;

    mapping(address => uint256) public lockedAmounts;
    mapping(bytes32 => bool) isConsumedQuote;
    mapping(bytes32 => bool) public isOnChainQuote;
    mapping(address => mapping(address => address)) public autoQuoteStrategy; // points to auto loan strategy for given coll/loan token pair
    DataTypes.OnChainQuote[] public onChainQuotes; // stores standing loan quotes
    mapping(address => address) public collTokenImplAddrs;
    DataTypes.Loan[] public loans; // stores loans

    uint256 public currLoanId;
    uint256 public loanQuoteNonce;
    address public owner;
    address public newOwner;
    address public compartmentFactory;

    /*
    can remove ILendingPool because also interest bearing tokens can be deposited 
    by virtue of simple transfer; e.g. lender can also deposit an atoken and allow
    borrowers to directly borrow the atoken; the repayment amount could then also be
    set to be atoken such that on repayment any idle funds automatically continue earning
    yield
    */

    error Invalid();
    error InvalidCompartmentAddr();

    event OnChainQuote(DataTypes.OnChainQuote onChainQuote, bool isActive);

    constructor(address _factoryAddr) {
        owner = msg.sender;
        loanQuoteNonce = 1;
        compartmentFactory = _factoryAddr;
    }

    function proposeNewOwner(address _newOwner) external {
        if (msg.sender != owner || _newOwner == address(0)) {
            revert Invalid();
        }
        newOwner = _newOwner;
    }

    function claimOwnership() external {
        if (msg.sender != newOwner) {
            revert Invalid();
        }
        owner = newOwner;
    }

    function invalidateQuotes() external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        loanQuoteNonce += 1;
    }

    function setAutoQuoteStrategy(
        address collToken,
        address loanToken,
        address strategyAddr
    ) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        autoQuoteStrategy[collToken][loanToken] = strategyAddr; // todo: add check if strategy is whitelisted by DAO
    }

    function withdraw(address token, uint256 amount) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        uint256 vaultBalance = IERC20Metadata(token).balanceOf(address(this));
        if (amount > vaultBalance - lockedAmounts[token]) {
            revert Invalid();
        }
        IERC20Metadata(token).safeTransfer(owner, amount);
    }

    function addOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        if (
            onChainQuote.collToken == address(0) || // todo: check if coll and loan token are whitelisted
            onChainQuote.loanToken == address(0) ||
            onChainQuote.collToken == onChainQuote.loanToken ||
            onChainQuote.timeUntilEarliestRepay > onChainQuote.tenor ||
            (onChainQuote.isNegativeInterestRate &&
                onChainQuote.interestRatePctInBase > BASE)
        ) {
            revert Invalid();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (isOnChainQuote[onChainQuoteHash]) {
            revert Invalid();
        }
        isOnChainQuote[onChainQuoteHash] = true;
        onChainQuotes.push(onChainQuote);
        emit OnChainQuote(onChainQuote, true);
    }

    function updateOnChainQuote(
        uint256 oldOnChainQuoteId,
        DataTypes.OnChainQuote calldata newOnChainQuote
    ) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        uint256 arrayLen = onChainQuotes.length;
        if (oldOnChainQuoteId > arrayLen - 1) {
            revert Invalid();
        }
        DataTypes.OnChainQuote memory oldOnChainQuote = onChainQuotes[
            oldOnChainQuoteId
        ];
        bytes32 oldOnChainQuoteHash = hashOnChainQuote(oldOnChainQuote);
        isOnChainQuote[oldOnChainQuoteHash] = false;

        bool deleteOnChainQuote = newOnChainQuote.collToken == address(0) ||
            newOnChainQuote.loanToken == address(0);
        if (deleteOnChainQuote) {
            onChainQuotes[oldOnChainQuoteId] = onChainQuotes[arrayLen - 1];
            onChainQuotes.pop();
        } else {
            bytes32 newOnChainQuoteHash = hashOnChainQuote(newOnChainQuote);
            if (oldOnChainQuoteHash == newOnChainQuoteHash) {
                revert Invalid();
            }
            isOnChainQuote[newOnChainQuoteHash] = true;
            onChainQuotes[oldOnChainQuoteId] = newOnChainQuote;
        }
        emit OnChainQuote(oldOnChainQuote, false);
        emit OnChainQuote(newOnChainQuote, true);
    }

    function borrow(
        address collToken,
        address loanToken,
        uint256 sendAmount,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        address strategyAddr = autoQuoteStrategy[collToken][loanToken];
        if (strategyAddr == address(0)) {
            revert Invalid();
        }
        currLoanId += 1;
        DataTypes.OnChainQuote memory onChainQuote; // = IAutoStrategy(strategyAddr).getStrategyValues()
        (
            uint256 feeAmount,
            DataTypes.Loan memory loan
        ) = _getFeeAndLoanExclCollAmount(onChainQuote, sendAmount);
        _borrowTransfers(loan, sendAmount, feeAmount, callbacker, data);
    }

    // possibly whitelist possible coll and borr tokens so that
    // previous borrowers don't have to worry some malicious
    // ERC-20 draining funds later? obviously for first prototype not needed
    // but something to keep in mind maybe
    function borrowWithOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote,
        uint256 sendAmount,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        if (!isOnChainQuote[hashOnChainQuote(onChainQuote)]) {
            revert Invalid();
        }
        currLoanId += 1;
        (
            uint256 feeAmount,
            DataTypes.Loan memory loan
        ) = _getFeeAndLoanExclCollAmount(onChainQuote, sendAmount);
        _borrowTransfers(loan, sendAmount, feeAmount, callbacker, data);
    }

    function borrowWithOffChainQuote(
        DataTypes.OffChainQuote calldata loanQuote,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        {
            bytes32 payloadHash = keccak256(
                abi.encode(
                    loanQuote.borrower,
                    loanQuote.collToken,
                    loanQuote.loanToken,
                    loanQuote.sendAmount,
                    loanQuote.loanAmount,
                    loanQuote.expiry,
                    loanQuote.earliestRepay,
                    loanQuote.repayAmount,
                    loanQuote.validUntil,
                    loanQuote.upfrontFee,
                    loanQuote.useCollCompartment
                    loanQuote.nonce
                )
            );
            if (
                isConsumedQuote[payloadHash] ||
                loanQuote.nonce >= loanQuoteNonce
            ) {
                revert Invalid();
            }
            isConsumedQuote[payloadHash] = true;

            bytes32 messageHash = keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n32",
                    payloadHash
                )
            );
            address signer = ecrecover(
                messageHash,
                loanQuote.v,
                loanQuote.r,
                loanQuote.s
            );

            if (signer != owner || loanQuote.validUntil < block.timestamp) {
                revert Invalid();
            }
            if (
                loanQuote.borrower != address(0) &&
                loanQuote.borrower != msg.sender
            ) {
                revert Invalid();
            }
        }

        currLoanId += 1;

        DataTypes.Loan memory loan;
        loan.borrower = msg.sender;
        loan.collToken = loanQuote.collToken;
        loan.loanToken = loanQuote.loanToken;
        loan.expiry = uint40(loanQuote.expiry);
        loan.earliestRepay = uint40(loanQuote.earliestRepay);
        loan.initRepayAmount = uint128(loanQuote.repayAmount);
        loan.initLoanAmount = uint128(loanQuote.loanAmount);
        loan.hasCollCompartment = loanQuote.useCollCompartment;

        _borrowTransfers(
            loan,
            loanQuote.sendAmount,
            loanQuote.upfrontFee,
            callbacker,
            data
        );
    }

    function _getFeeAndLoanExclCollAmount(
        DataTypes.OnChainQuote memory onChainQuote,
        uint256 sendAmount
    ) internal view returns (uint256 feeAmount, DataTypes.Loan memory loan) {
        uint256 loanAmount = (onChainQuote.loanPerCollUnit * sendAmount) /
            (10 ** IERC20Metadata(onChainQuote.collToken).decimals());
        if (uint128(loanAmount) != loanAmount) {
            revert Invalid();
        }
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
        if (uint128(repayAmount) != repayAmount) {
            revert Invalid();
        }

        loan.borrower = msg.sender;
        loan.collToken = onChainQuote.collToken;
        loan.loanToken = onChainQuote.loanToken;
        loan.initLoanAmount = uint128(loanAmount);
        loan.initRepayAmount = uint128(repayAmount);
        loan.expiry = uint40(block.timestamp + onChainQuote.tenor);
        loan.earliestRepay = uint40(
            block.timestamp + onChainQuote.timeUntilEarliestRepay
        );
        feeAmount = (sendAmount * onChainQuote.upfrontFeePctInBase) / BASE;
    }

    function _borrowTransfers(
        DataTypes.Loan memory loan,
        uint256 sendAmount,
        uint256 upfrontFee,
        address callbacker,
        bytes calldata data
    ) internal {
        uint256 loanTokenBalBefore = IERC20Metadata(loan.loanToken).balanceOf(
            address(this)
        );
        if (
            loanTokenBalBefore - lockedAmounts[loan.loanToken] <
            loan.initLoanAmount
        ) {
            revert();
        }
        uint256 collTokenBalBefore = IERC20Metadata(loan.collToken).balanceOf(
            address(this)
        );

        IERC20Metadata(loan.loanToken).safeTransfer(
            msg.sender,
            loan.initLoanAmount
        );
        if (callbacker != address(0)) {
            IVaultFlashCallback(callbacker).vaultFlashCallback(loan, data); // todo: whitelist callbacker
        }

        uint256 loanTokenBalAfter = IERC20Metadata(loan.loanToken).balanceOf(
            address(this)
        );

        // check exactly that at least correct loan amount is sent
        if (loanTokenBalBefore - loanTokenBalAfter < loan.initLoanAmount) {
            revert Invalid();
        }

        // send the vault full collateral amount
        IERC20Metadata(loan.collToken).safeTransferFrom(
            msg.sender,
            address(this),
            sendAmount
        );

        uint256 collTokenBalAfter = IERC20Metadata(loan.collToken).balanceOf(
            address(this)
        );

        // test that upfrontFee is not bigger than post transfer fee on collateral
        if (collTokenBalAfter - collTokenBalBefore < upfrontFee) {
            revert Invalid();
        }

        uint256 reclaimable = collTokenBalAfter -
            collTokenBalBefore -
            upfrontFee;
        if (reclaimable != uint128(reclaimable)) {
            revert Invalid();
        }

        if (loan.hasCollCompartment) {
            (
                loan.collTokenCompartmentAddr,
                loan.initCollAmount
            ) = createCompartments(loan, reclaimable);
        } else {
            loan.initCollAmount = uint128(reclaimable);
            lockedAmounts[loan.collToken] += uint128(reclaimable);
        }
        loans.push(loan);
    }

    function repay(
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        DataTypes.Loan memory loan = loans[loanRepayInfo.loanId];
        if (msg.sender != loan.borrower) {
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
        uint256 reclaimCollAmount = (loan.initCollAmount *
            loanRepayInfo.repayAmount) / loan.initRepayAmount;

        uint256 loanTokenBalBefore = IERC20Metadata(loanRepayInfo.loanToken)
            .balanceOf(address(this));
        uint256 collTokenBalBefore = IERC20Metadata(loanRepayInfo.collToken)
            .balanceOf(address(this));

        if (loan.hasCollCompartment) {
            ICompartment(loan.collTokenCompartmentAddr).transferCollToBorrower(
                reclaimCollAmount,
                loan.borrower,
                loan.collToken
            );
        } else {
            IERC20Metadata(loanRepayInfo.collToken).safeTransfer(
                msg.sender,
                reclaimCollAmount
            );
        }

        if (callbacker != address(0)) {
            IVaultFlashCallback(callbacker).vaultFlashCallback(loan, data); // todo: whitelist callbacker
        }
        IERC20Metadata(loanRepayInfo.loanToken).safeTransferFrom(
            msg.sender,
            address(this),
            loanRepayInfo.repayAmount + loanRepayInfo.loanTokenTransferFees
        );

        uint256 loanTokenBalAfter = IERC20Metadata(loanRepayInfo.loanToken)
            .balanceOf(address(this));

        uint256 loanTokenAmountReceived = loanTokenBalAfter -
            loanTokenBalBefore;
        uint256 collTokenBalAfter = IERC20Metadata(loanRepayInfo.collToken)
            .balanceOf(address(this));

        if (loanTokenAmountReceived < loanRepayInfo.repayAmount) {
            revert Invalid();
        }
        // balance only changes when no compartment
        if (
            !loan.hasCollCompartment &&
            collTokenBalBefore - collTokenBalAfter < reclaimCollAmount
        ) {
            revert Invalid();
        }

        loan.amountRepaidSoFar += uint128(loanTokenAmountReceived);
        // only update lockedAmounts when no compartment
        if (!loan.hasCollCompartment) {
            lockedAmounts[loanRepayInfo.collToken] -= uint128(
                reclaimCollAmount
            );
        }
    }

    function unlockCollateral(
        address collToken,
        uint256[] calldata _loanIds
    ) external {
        uint256 totalUnlockableColl;
        for (uint256 i = 0; i < _loanIds.length; ) {
            uint256 tmp = 0;
            DataTypes.Loan storage loan = loans[_loanIds[i]];
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
            owner,
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
                onChainQuote.isNegativeInterestRate
                onChainQuote.useCollCompartment
            )
        );
    }

    // internal helper for stack running too deep
    function createCompartments(
        DataTypes.Loan memory loan,
        uint256 reclaimable
    ) internal returns (address compartmentAddr, uint128 initCollAmount) {
        address implAddr = collTokenImplAddrs[loan.collToken];
        bytes32 salt = keccak256(
            abi.encode(
                implAddr,
                address(this),
                msg.sender,
                loan.collToken,
                loans.length
            )
        );
        address _predictedNewCompartmentAddress = Clones
            .predictDeterministicAddress(implAddr, salt, compartmentFactory);

        uint256 collTokenBalBefore = IERC20Metadata(loan.collToken).balanceOf(
            _predictedNewCompartmentAddress
        );

        IERC20Metadata(loan.collToken).safeTransfer(
            _predictedNewCompartmentAddress,
            reclaimable
        );

        uint256 collTokenBalAfter = IERC20Metadata(loan.collToken).balanceOf(
            _predictedNewCompartmentAddress
        );

        compartmentAddr = ICompartmentFactory(compartmentFactory)
            .createCompartment(
                implAddr,
                address(this),
                msg.sender,
                loan.collToken,
                loans.length
            );
        if (compartmentAddr != _predictedNewCompartmentAddress) {
            revert InvalidCompartmentAddr();
        }
        // balance difference in coll token of the vault after...
        // 1) transfer fee into vault on transfer from sender
        // 2) remove upfrontFee
        // 3) transfer fee into compartment from vault
        initCollAmount = uint128(collTokenBalAfter - collTokenBalBefore);
    }
}
