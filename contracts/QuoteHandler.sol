// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {DataTypes} from "./DataTypes.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";
import "hardhat/console.sol";

contract QuoteHandler {
    using SafeERC20 for IERC20Metadata;

    uint256 constant BASE = 1e18;
    address addressRegistry;
    mapping(address => uint256) offChainQuoteNonce;
    mapping(address => mapping(bytes32 => bool)) offChainQuoteIsInvalidated;
    mapping(address => mapping(bytes32 => bool)) public isOnChainQuote;
    mapping(address => mapping(address => bool))
        public isActiveAutoQuoteStrategy;

    event OnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote onChainQuote,
        bytes32 onChainQuoteHash,
        bool isActive
    );

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    function addOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        if (!isValidOnChainQuote(onChainQuote)) {
            revert();
        }
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                onChainQuote.generalQuoteInfo.collToken,
                onChainQuote.generalQuoteInfo.loanToken
            )
        ) {
            revert();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = true;
        emit OnChainQuote(lenderVault, onChainQuote, onChainQuoteHash, true);
    }

    function updateOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata oldOnChainQuote,
        DataTypes.OnChainQuote calldata newOnChainQuote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        if (!isValidOnChainQuote(newOnChainQuote)) {
            revert();
        }
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                newOnChainQuote.generalQuoteInfo.collToken,
                newOnChainQuote.generalQuoteInfo.loanToken
            )
        ) {
            revert();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(oldOnChainQuote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = false;
        emit OnChainQuote(
            lenderVault,
            oldOnChainQuote,
            onChainQuoteHash,
            false
        );
        onChainQuoteHash = hashOnChainQuote(newOnChainQuote);
        isOnChainQuote[lenderVault][onChainQuoteHash] = true;
        emit OnChainQuote(lenderVault, newOnChainQuote, onChainQuoteHash, true);
    }

    function deleteOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = false;
        emit OnChainQuote(lenderVault, onChainQuote, onChainQuoteHash, false);
    }

    function addAutoQuoteStrategy() external {}

    function doesAcceptOnChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OnChainQuote memory onChainQuote
    ) external view returns (bool) {
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                onChainQuote.generalQuoteInfo.collToken,
                onChainQuote.generalQuoteInfo.loanToken
            )
        ) {
            return false;
        }
        if (
            onChainQuote.generalQuoteInfo.borrower != address(0) &&
            onChainQuote.generalQuoteInfo.borrower != borrower
        ) {
            return false;
        }
        return isOnChainQuote[lenderVault][hashOnChainQuote(onChainQuote)];
    }

    function doesAcceptAutoQuote(
        address borrower,
        address /*lenderVault*/,
        DataTypes.OnChainQuote memory onChainQuote
    ) external view returns (bool) {
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                onChainQuote.generalQuoteInfo.collToken,
                onChainQuote.generalQuoteInfo.loanToken
            )
        ) {
            return false;
        }
        if (
            onChainQuote.generalQuoteInfo.borrower != address(0) &&
            onChainQuote.generalQuoteInfo.borrower != borrower
        ) {
            return false;
        }
        return false;
        /*
        return
            autoQuoteStrategy[onChainQuote.quote.collToken][onChainQuote.quote.loanToken] !=
            address(0);
        */
    }

    function doesAcceptOffChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OffChainQuote calldata offChainQuote,
        DataTypes.QuoteTuple calldata quoteTuple,
        bytes32[] memory proof
    ) external view returns (bool) {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                offChainQuote.generalQuoteInfo.collToken,
                offChainQuote.generalQuoteInfo.loanToken
            )
        ) {
            return false;
        }
        if (
            offChainQuote.generalQuoteInfo.borrower != address(0) &&
            offChainQuote.generalQuoteInfo.borrower != borrower
        ) {
            return false;
        }
        if (offChainQuote.nonce > offChainQuoteNonce[lenderVault]) {
            return false;
        }
        bytes32 offChainQuoteHash = hashOffChainQuote(offChainQuote);
        if (offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash]) {
            return false;
        }
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                offChainQuoteHash
            )
        );
        address recoveredSigner = ecrecover(
            messageHash,
            offChainQuote.v,
            offChainQuote.r,
            offChainQuote.s
        );
        if (
            recoveredSigner != ILenderVault(lenderVault).vaultOwner() ||
            offChainQuote.generalQuoteInfo.validUntil < block.timestamp
        ) {
            return false;
        }
        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        quoteTuple.loanPerCollUnitOrLtv,
                        quoteTuple.interestRatePctInBase,
                        quoteTuple.upfrontFeePctInBase,
                        quoteTuple.tenor
                    )
                )
            )
        );
        if (!MerkleProof.verify(proof, offChainQuote.quoteTuplesRoot, leaf)) {
            return false;
        }
        return true;
    }

    function incrementOffChainQuoteNonce(address lenderVault) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        offChainQuoteNonce[lenderVault] += 1;
    }

    function invalidateOffChainQuote(
        address lenderVault,
        bytes32 offChainQuoteHash
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash] = true;
    }

    function hashOnChainQuote(
        DataTypes.OnChainQuote memory onChainQuote
    ) public pure returns (bytes32 quoteHash) {
        quoteHash = keccak256(abi.encode(onChainQuote));
    }

    function hashOffChainQuote(
        DataTypes.OffChainQuote memory offChainQuote
    ) public pure returns (bytes32 quoteHash) {
        quoteHash = keccak256(
            abi.encode(
                offChainQuote.generalQuoteInfo,
                offChainQuote.quoteTuplesRoot,
                offChainQuote.salt,
                offChainQuote.nonce
            )
        );
    }

    function isValidOnChainQuote(
        DataTypes.OnChainQuote calldata /*onChainQuote*/
    ) public view returns (bool) {
        return true;
        /*
        console.log("PASS 1");
        if (quote.collToken == quote.loanToken) {
            return false;
        }
        console.log("PASS 2");
        console.log("PASS 3");
        if (
            quote.quoteTuples.loanPerCollUnitOrLtv.length !=
            quote.quoteTuples.tenor.length ||
            quote.quoteTuples.loanPerCollUnitOrLtv.length !=
            quote.quoteTuples.interestRatePctInBase.length ||
            quote.quoteTuples.loanPerCollUnitOrLtv.length !=
            quote.quoteTuples.upfrontFeePctInBase.length
        ) {
            return false;
        }
        console.log("PASS 4");
        console.log("PASS 5");
        if (quote.validUntil < block.timestamp) {
            return false;
        }
        console.log("PASS 6");
        for (
            uint256 k = 0;
            k < quote.quoteTuples.loanPerCollUnitOrLtv.length;

        ) {
            if (quote.quoteTuples.upfrontFeePctInBase[k] > BASE) {
                return false;
            }
            console.log("PASS 7");
            if (
                quote.oracleAddr != address(0) &&
                quote.quoteTuples.loanPerCollUnitOrLtv[k] >= BASE
            ) {
                return false;
            }
            console.log("PASS 8");
            if (
                quote.quoteTuples.isNegativeInterestRate &&
                quote.quoteTuples.interestRatePctInBase[k] > BASE
            ) {
                return false;
            }
            console.log("PASS 9");
            unchecked {
                k++;
            }
        }
        return true;
        */
    }

    function fromQuoteToLoanInfo(
        address borrower,
        uint256 collSendAmount,
        uint256 expectedTransferFee,
        DataTypes.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypes.QuoteTuple calldata quoteTuple
    ) external view returns (DataTypes.Loan memory loan, uint256 upfrontFee) {
        loan.borrower = borrower;
        if (collSendAmount < expectedTransferFee) {
            revert(); // InsufficientSendAmount();
        }
        if (generalQuoteInfo.oracleAddr != address(0)) {
            revert(); // ToDo: implement oracle handling
        }
        uint256 loanAmount = (quoteTuple.loanPerCollUnitOrLtv *
            (collSendAmount - expectedTransferFee)) /
            (10 ** IERC20Metadata(generalQuoteInfo.collToken).decimals());
        uint256 repayAmount;
        int256 _interestRate = int256(BASE) + quoteTuple.interestRatePctInBase;
        if (_interestRate < 0) {
            revert();
        }
        uint256 interestRateFactor = uint256(_interestRate);
        repayAmount = (loanAmount * interestRateFactor) / BASE;
        upfrontFee = (collSendAmount * quoteTuple.upfrontFeePctInBase) / BASE;
        // minimum coll amount to prevent griefing attacks or small unlocks that aren't worth it
        if (
            loanAmount < generalQuoteInfo.minLoan ||
            loanAmount > generalQuoteInfo.maxLoan
        ) {
            revert(); // revert InsufficientSendAmount();
        }
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
        if (generalQuoteInfo.borrowerCompartmentImplementation != address(0)) {
            loan = setCompartmentLoanData(
                generalQuoteInfo.borrowerCompartmentImplementation,
                borrower,
                loan
            );
        }
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
                borrower
                //_loans.length // ToDo: use unique loan id (either pass from lenderVault or call from QuoteHandler)
            )
        );
        loan.collTokenCompartmentAddr = Clones.predictDeterministicAddress(
            borrowerCompartmentImplementation,
            salt,
            IAddressRegistry(address(0)).borrowerCompartmentFactory()
        );
        return loan;
    }

    function toUint128(uint256 x) internal pure returns (uint128 y) {
        y = uint128(x);
        if (y != x) {
            revert();
        }
    }
}
