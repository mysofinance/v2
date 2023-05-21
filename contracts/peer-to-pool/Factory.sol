// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Constants} from "../Constants.sol";
import {Errors} from "../Errors.sol";
import {Ownable} from "../Ownable.sol";
import {IFactory} from "./interfaces/IFactory.sol";
import {IFundingPoolImpl} from "./interfaces/IFundingPoolImpl.sol";
import {ILoanProposalImpl} from "./interfaces/ILoanProposalImpl.sol";
import {IMysoTokenManager} from "../interfaces/IMysoTokenManager.sol";

contract Factory is Ownable, ReentrancyGuard, IFactory {
    using ECDSA for bytes32;

    uint256 public arrangerFeeSplit;
    address public immutable loanProposalImpl;
    address public immutable fundingPoolImpl;
    address public mysoTokenManager;
    address[] public loanProposals;
    address[] public fundingPools;
    mapping(address => bool) public isLoanProposal;
    mapping(address => bool) public isFundingPool;
    mapping(address => bool) internal _depositTokenHasFundingPool;
    mapping(address => mapping(address => uint256))
        internal _lenderWhitelistedUntil;

    constructor(address _loanProposalImpl, address _fundingPoolImpl) Ownable() {
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
        if (!isFundingPool[_fundingPool]) {
            revert Errors.InvalidAddress();
        }
        uint256 numLoanProposals = loanProposals.length;
        bytes32 salt = keccak256(
            abi.encodePacked(loanProposalImpl, msg.sender, numLoanProposals)
        );
        address newLoanProposal = Clones.cloneDeterministic(
            loanProposalImpl,
            salt
        );
        loanProposals.push(newLoanProposal);
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
            _unsubscribeGracePeriod
        );
    }

    function createFundingPool(address _depositToken) external {
        if (_depositTokenHasFundingPool[_depositToken]) {
            revert Errors.FundingPoolAlreadyExists();
        }
        bytes32 salt = keccak256(
            abi.encodePacked(_depositToken, fundingPools.length)
        );
        address newFundingPool = Clones.cloneDeterministic(
            fundingPoolImpl,
            salt
        );
        fundingPools.push(newFundingPool);
        isFundingPool[newFundingPool] = true;
        _depositTokenHasFundingPool[_depositToken] = true;
        IFundingPoolImpl(newFundingPool).initialize(
            address(this),
            _depositToken
        );

        emit FundingPoolCreated(newFundingPool, _depositToken);
    }

    function setArrangerFeeSplit(uint256 _newArrangerFeeSplit) external {
        _senderCheckOwner();
        uint256 oldArrangerFeeSplit = arrangerFeeSplit;
        if (
            _newArrangerFeeSplit > Constants.MAX_ARRANGER_SPLIT ||
            _newArrangerFeeSplit == oldArrangerFeeSplit
        ) {
            revert Errors.InvalidFee();
        }
        arrangerFeeSplit = _newArrangerFeeSplit;
        emit ArrangerFeeSplitUpdated(oldArrangerFeeSplit, _newArrangerFeeSplit);
    }

    function claimLenderWhitelistStatus(
        address whitelistAuthority,
        uint256 whitelistedUntil,
        bytes memory signature,
        bytes32 salt
    ) external {
        bytes32 payloadHash = keccak256(
            abi.encode(msg.sender, whitelistedUntil, block.chainid, salt)
        );
        bytes32 messageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash)
        );
        address recoveredSigner = messageHash.recover(signature);
        if (
            whitelistAuthority == address(0) ||
            recoveredSigner != whitelistAuthority
        ) {
            revert Errors.InvalidSignature();
        }
        if (
            whitelistedUntil < block.timestamp ||
            whitelistedUntil <=
            _lenderWhitelistedUntil[whitelistAuthority][msg.sender]
        ) {
            revert Errors.CannotClaimOutdatedStatus();
        }
        _lenderWhitelistedUntil[whitelistAuthority][
            msg.sender
        ] = whitelistedUntil;
        emit LenderWhitelistStatusClaimed(
            whitelistAuthority,
            msg.sender,
            whitelistedUntil
        );
    }

    function updateLenderWhitelist(
        address[] memory lenders,
        uint256 whitelistedUntil
    ) external {
        for (uint i = 0; i < lenders.length; ) {
            if (
                lenders[i] == address(0) ||
                whitelistedUntil ==
                _lenderWhitelistedUntil[msg.sender][lenders[i]]
            ) {
                revert Errors.InvalidUpdate();
            }
            _lenderWhitelistedUntil[msg.sender][lenders[i]] = whitelistedUntil;
            unchecked {
                i++;
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
            _lenderWhitelistedUntil[whitelistAuthority][lender] >
            block.timestamp;
    }
}
