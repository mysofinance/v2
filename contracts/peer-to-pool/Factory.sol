// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Constants} from "../Constants.sol";
import {Errors} from "../Errors.sol";
import {Helpers} from "../Helpers.sol";
import {Ownable} from "../Ownable.sol";
import {IFactory} from "./interfaces/IFactory.sol";
import {IFundingPoolImpl} from "./interfaces/IFundingPoolImpl.sol";
import {ILoanProposalImpl} from "./interfaces/ILoanProposalImpl.sol";
import {IMysoTokenManager} from "../interfaces/IMysoTokenManager.sol";

contract Factory is Ownable, ReentrancyGuard, IFactory {
    using ECDSA for bytes32;

    uint256 public protocolFee;
    address public immutable loanProposalImpl;
    address public immutable fundingPoolImpl;
    address public mysoTokenManager;
    address[] public loanProposals;
    address[] public fundingPools;
    mapping(address => bool) public isLoanProposal;
    mapping(address => bool) public isFundingPool;
    mapping(bytes => bool) internal _signatureIsInvalidated;
    mapping(address => bool) internal _depositTokenHasFundingPool;
    mapping(address => mapping(address => uint256))
        internal _lenderWhitelistedUntil;

    constructor(address _loanProposalImpl, address _fundingPoolImpl) {
        if (_loanProposalImpl == address(0) || _fundingPoolImpl == address(0)) {
            revert Errors.InvalidAddress();
        }
        loanProposalImpl = _loanProposalImpl;
        fundingPoolImpl = _fundingPoolImpl;
    }

    function createLoanProposal(
        address _fundingPool,
        address _collToken,
        address _whitelistAuthority,
        uint256 _arrangerFee,
        uint256 _unsubscribeGracePeriod,
        uint256 _conversionGracePeriod,
        uint256 _repaymentGracePeriod
    ) external nonReentrant {
        if (!isFundingPool[_fundingPool] || _collToken == address(0)) {
            revert Errors.InvalidAddress();
        }
        address newLoanProposal = Clones.clone(loanProposalImpl);
        loanProposals.push(newLoanProposal);
        uint256 numLoanProposals = loanProposals.length;
        isLoanProposal[newLoanProposal] = true;
        address _mysoTokenManager = mysoTokenManager;
        if (_mysoTokenManager != address(0)) {
            IMysoTokenManager(_mysoTokenManager)
                .processP2PoolCreateLoanProposal(
                    _fundingPool,
                    msg.sender,
                    _collToken,
                    _arrangerFee,
                    numLoanProposals
                );
        }
        ILoanProposalImpl(newLoanProposal).initialize(
            address(this),
            msg.sender,
            _fundingPool,
            _collToken,
            _whitelistAuthority,
            _arrangerFee,
            _unsubscribeGracePeriod,
            _conversionGracePeriod,
            _repaymentGracePeriod
        );

        emit LoanProposalCreated(
            newLoanProposal,
            _fundingPool,
            msg.sender,
            _collToken,
            _arrangerFee,
            _unsubscribeGracePeriod,
            numLoanProposals
        );
    }

    function createFundingPool(address _depositToken) external {
        if (_depositTokenHasFundingPool[_depositToken]) {
            revert Errors.FundingPoolAlreadyExists();
        }
        address newFundingPool = Clones.clone(fundingPoolImpl);
        fundingPools.push(newFundingPool);
        isFundingPool[newFundingPool] = true;
        _depositTokenHasFundingPool[_depositToken] = true;
        IFundingPoolImpl(newFundingPool).initialize(
            address(this),
            _depositToken
        );

        emit FundingPoolCreated(
            newFundingPool,
            _depositToken,
            fundingPools.length
        );
    }

    function setProtocolFee(uint256 _newprotocolFee) external {
        _senderCheckOwner();
        uint256 oldprotocolFee = protocolFee;
        if (
            _newprotocolFee > Constants.MAX_P2POOL_PROTOCOL_FEE ||
            _newprotocolFee == oldprotocolFee
        ) {
            revert Errors.InvalidFee();
        }
        protocolFee = _newprotocolFee;
        emit ProtocolFeeUpdated(oldprotocolFee, _newprotocolFee);
    }

    function claimLenderWhitelistStatus(
        address whitelistAuthority,
        uint256 whitelistedUntil,
        bytes calldata compactSig,
        bytes32 salt
    ) external {
        if (_signatureIsInvalidated[compactSig]) {
            revert Errors.InvalidSignature();
        }
        bytes32 payloadHash = keccak256(
            abi.encode(
                address(this),
                msg.sender,
                whitelistedUntil,
                block.chainid,
                salt
            )
        );
        bytes32 messageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash)
        );
        (bytes32 r, bytes32 vs) = Helpers.splitSignature(compactSig);
        address recoveredSigner = messageHash.recover(r, vs);
        if (
            whitelistAuthority == address(0) ||
            recoveredSigner != whitelistAuthority
        ) {
            revert Errors.InvalidSignature();
        }
        mapping(address => uint256)
            storage whitelistedUntilPerLender = _lenderWhitelistedUntil[
                whitelistAuthority
            ];
        if (
            whitelistedUntil < block.timestamp ||
            whitelistedUntil <= whitelistedUntilPerLender[msg.sender]
        ) {
            revert Errors.CannotClaimOutdatedStatus();
        }
        whitelistedUntilPerLender[msg.sender] = whitelistedUntil;
        _signatureIsInvalidated[compactSig] = true;
        emit LenderWhitelistStatusClaimed(
            whitelistAuthority,
            msg.sender,
            whitelistedUntil
        );
    }

    function updateLenderWhitelist(
        address[] calldata lenders,
        uint256 whitelistedUntil
    ) external {
        if (lenders.length == 0) {
            revert Errors.InvalidArrayLength();
        }
        for (uint256 i; i < lenders.length; ) {
            mapping(address => uint256)
                storage whitelistedUntilPerLender = _lenderWhitelistedUntil[
                    msg.sender
                ];
            if (
                lenders[i] == address(0) ||
                whitelistedUntil == whitelistedUntilPerLender[lenders[i]]
            ) {
                revert Errors.InvalidUpdate();
            }
            whitelistedUntilPerLender[lenders[i]] = whitelistedUntil;
            unchecked {
                ++i;
            }
        }
        emit LenderWhitelistUpdated(msg.sender, lenders, whitelistedUntil);
    }

    function setMysoTokenManager(address newTokenManager) external {
        _senderCheckOwner();
        address oldTokenManager = mysoTokenManager;
        if (oldTokenManager == newTokenManager) {
            revert Errors.InvalidAddress();
        }
        mysoTokenManager = newTokenManager;
        emit MysoTokenManagerUpdated(oldTokenManager, newTokenManager);
    }

    function owner()
        external
        view
        override(Ownable, IFactory)
        returns (address)
    {
        return _owner;
    }

    function isWhitelistedLender(
        address whitelistAuthority,
        address lender
    ) external view returns (bool) {
        return
            _lenderWhitelistedUntil[whitelistAuthority][lender] >=
            block.timestamp;
    }
}
