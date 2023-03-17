// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Constants} from "../Constants.sol";
import {DataTypes} from "./DataTypes.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {ILenderVaultImpl} from "./interfaces/ILenderVaultImpl.sol";
import {IQuoteHandler} from "./interfaces/IQuoteHandler.sol";
import {IEvents} from "./interfaces/IEvents.sol";
import {Errors} from "../Errors.sol";

contract QuoteHandler is IQuoteHandler, IEvents {
    address public immutable addressRegistry;
    mapping(address => uint256) public offChainQuoteNonce;
    mapping(address => mapping(bytes32 => bool))
        public offChainQuoteIsInvalidated;
    mapping(address => mapping(bytes32 => bool)) public isOnChainQuote;

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    function addOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        address _addressRegistry = addressRegistry;
        if (
            !IAddressRegistry(_addressRegistry).isRegisteredVault(lenderVault)
        ) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        if (!isValidOnChainQuote(onChainQuote)) {
            revert Errors.InvalidChainQuote();
        }
        if (
            !IAddressRegistry(_addressRegistry).isWhitelistedToken(
                onChainQuote.generalQuoteInfo.collToken
            ) ||
            !IAddressRegistry(_addressRegistry).isWhitelistedToken(
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
        emit OnChainQuoteAdded(lenderVault, onChainQuote, onChainQuoteHash);
    }

    function updateOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata oldOnChainQuote,
        DataTypes.OnChainQuote calldata newOnChainQuote
    ) external {
        address _addressRegistry = addressRegistry;
        if (
            !IAddressRegistry(_addressRegistry).isRegisteredVault(lenderVault)
        ) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        if (!isValidOnChainQuote(newOnChainQuote)) {
            revert Errors.InvalidChainQuote();
        }
        if (
            !IAddressRegistry(_addressRegistry).isWhitelistedToken(
                newOnChainQuote.generalQuoteInfo.collToken
            ) ||
            !IAddressRegistry(_addressRegistry).isWhitelistedToken(
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
        emit OnChainQuoteDeleted(lenderVault, onChainQuoteHash);
        onChainQuoteHash = hashOnChainQuote(newOnChainQuote);
        isOnChainQuote[lenderVault][onChainQuoteHash] = true;
        emit OnChainQuoteAdded(lenderVault, newOnChainQuote, onChainQuoteHash);
    }

    function deleteOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = false;
        emit OnChainQuoteDeleted(lenderVault, onChainQuoteHash);
    }

    function incrementOffChainQuoteNonce(address lenderVault) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        offChainQuoteNonce[lenderVault] += 1;
    }

    function invalidateOffChainQuote(
        address lenderVault,
        bytes32 offChainQuoteHash
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash] = true;
        emit OffChainQuoteInvalidated(lenderVault, offChainQuoteHash);
    }

    function checkAndRegisterOnChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external {
        checkSenderAndGeneralQuoteInfo(
            borrower,
            lenderVault,
            onChainQuote.generalQuoteInfo
        );
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        if (onChainQuote.generalQuoteInfo.isSingleUse) {
            isOnChainQuote[lenderVault][onChainQuoteHash] = false;
            emit OnChainQuoteInvalidated(lenderVault, onChainQuoteHash);
        }
    }

    function checkAndRegisterOffChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OffChainQuote calldata offChainQuote,
        DataTypes.QuoteTuple calldata quoteTuple,
        bytes32[] memory proof
    ) external {
        checkSenderAndGeneralQuoteInfo(
            borrower,
            lenderVault,
            offChainQuote.generalQuoteInfo
        );
        if (offChainQuote.nonce > offChainQuoteNonce[lenderVault]) {
            revert();
        }
        if (offChainQuote.generalQuoteInfo.validUntil < block.timestamp) {
            revert();
        }
        bytes32 offChainQuoteHash = hashOffChainQuote(offChainQuote);
        if (offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash]) {
            revert();
        }
        if (
            !areValidSignatures(
                lenderVault,
                offChainQuoteHash,
                offChainQuote.v,
                offChainQuote.r,
                offChainQuote.s
            )
        ) {
            revert();
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
            revert();
        }
        if (offChainQuote.generalQuoteInfo.isSingleUse) {
            offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash] = true;
            emit OffChainQuoteInvalidated(lenderVault, offChainQuoteHash);
        }
    }

    function areValidSignatures(
        address lenderVault,
        bytes32 offChainQuoteHash,
        uint8[] calldata v,
        bytes32[] calldata r,
        bytes32[] calldata s
    ) internal view returns (bool) {
        if (
            v.length != r.length &&
            v.length != s.length &&
            v.length != ILenderVaultImpl(lenderVault).minNumOfSigners()
        ) {
            return false;
        }
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                offChainQuoteHash
            )
        );
        uint256 tmp;
        address recoveredSigner;
        uint256 newHash;
        for (uint256 i = 0; i < v.length; ) {
            recoveredSigner = ecrecover(messageHash, v[i], r[i], s[i]);
            // use hash instead of address to spread out over 256 bits and reduce false positives
            newHash = uint256(keccak256(abi.encode(recoveredSigner)));
            if (tmp == tmp | newHash) {
                return false;
            }

            if (!ILenderVaultImpl(lenderVault).isSigner(recoveredSigner)) {
                return false;
            }
            tmp |= newHash;
            unchecked {
                i++;
            }
        }
        return true;
    }

    function hashOffChainQuote(
        DataTypes.OffChainQuote memory offChainQuote
    ) internal view returns (bytes32 quoteHash) {
        quoteHash = keccak256(
            abi.encode(
                offChainQuote.generalQuoteInfo,
                offChainQuote.quoteTuplesRoot,
                offChainQuote.salt,
                offChainQuote.nonce,
                block.chainid
            )
        );
    }

    function checkSenderAndGeneralQuoteInfo(
        address borrower,
        address lenderVault,
        DataTypes.GeneralQuoteInfo calldata generalQuoteInfo
    ) internal view {
        address _addressRegistry = addressRegistry;
        if (
            msg.sender != IAddressRegistry(_addressRegistry).borrowerGateway()
        ) {
            revert();
        }
        if (
            !IAddressRegistry(_addressRegistry).isRegisteredVault(lenderVault)
        ) {
            revert Errors.UnregisteredVault();
        }
        if (
            !IAddressRegistry(_addressRegistry).isWhitelistedToken(
                generalQuoteInfo.collToken
            ) ||
            !IAddressRegistry(_addressRegistry).isWhitelistedToken(
                generalQuoteInfo.loanToken
            )
        ) {
            revert();
        }
        if (generalQuoteInfo.collToken == generalQuoteInfo.loanToken) {
            revert();
        }
        if (
            generalQuoteInfo.borrower != address(0) &&
            generalQuoteInfo.borrower != borrower
        ) {
            revert();
        }
    }

    function isValidOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote
    ) internal view returns (bool) {
        if (
            onChainQuote.generalQuoteInfo.collToken ==
            onChainQuote.generalQuoteInfo.loanToken
        ) {
            return false;
        }
        if (onChainQuote.quoteTuples.length == 0) {
            return false;
        }
        if (onChainQuote.generalQuoteInfo.validUntil < block.timestamp) {
            return false;
        }
        if (
            onChainQuote.generalQuoteInfo.maxLoan == 0 ||
            onChainQuote.generalQuoteInfo.minLoan >
            onChainQuote.generalQuoteInfo.maxLoan
        ) {
            return false;
        }
        for (uint256 k = 0; k < onChainQuote.quoteTuples.length; ) {
            if (
                onChainQuote.quoteTuples[k].upfrontFeePctInBase > Constants.BASE
            ) {
                return false;
            }
            if (
                onChainQuote.generalQuoteInfo.oracleAddr != address(0) &&
                onChainQuote.quoteTuples[k].loanPerCollUnitOrLtv >=
                Constants.BASE
            ) {
                return false;
            }
            if (
                onChainQuote.quoteTuples[k].interestRatePctInBase +
                    int(Constants.BASE) <=
                0
            ) {
                return false;
            }
            if (
                onChainQuote.quoteTuples[k].tenor <=
                onChainQuote.generalQuoteInfo.earliestRepayTenor
            ) {
                return false;
            }
            unchecked {
                k++;
            }
        }
        return true;
    }

    function hashOnChainQuote(
        DataTypes.OnChainQuote memory onChainQuote
    ) internal pure returns (bytes32 quoteHash) {
        quoteHash = keccak256(abi.encode(onChainQuote));
    }
}
