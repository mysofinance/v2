// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IFactory} from "./interfaces/IFactory.sol";
import {IFundingPoolImpl} from "./interfaces/IFundingPoolImpl.sol";
import {ILoanProposalImpl} from "./interfaces/ILoanProposalImpl.sol";
import {Constants} from "../Constants.sol";
import {Errors} from "../Errors.sol";
import {Ownable} from "../Ownable.sol";

contract Factory is Ownable, IFactory {
    using ECDSA for bytes32;

    uint256 public arrangerFeeSplit;
    address public immutable loanProposalImpl;
    address public immutable fundingPoolImpl;
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
    ) external {
        if (!isFundingPool[_fundingPool] || _collToken == address(0)) {
            revert Errors.InvalidAddress();
        }
        bytes32 salt = keccak256(
            abi.encodePacked(loanProposalImpl, msg.sender, loanProposals.length)
        );
        address newLoanProposal = Clones.cloneDeterministic(
            loanProposalImpl,
            salt
        );
        loanProposals.push(newLoanProposal);
        isLoanProposal[newLoanProposal] = true;
        ILoanProposalImpl(newLoanProposal).initialize(
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
        bytes calldata signature,
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
        for (uint i = 0; i < lenders.length; ) {
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
                i++;
            }
        }
        emit LenderWhitelistUpdated(msg.sender, lenders, whitelistedUntil);
    }

    function isWhitelistedBorrower(
        address whitelistAuthority,
        address borrower
    ) external view returns (bool) {
        return
            _lenderWhitelistedUntil[whitelistAuthority][borrower] >
            block.timestamp;
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
