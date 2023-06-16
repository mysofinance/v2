// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DataTypesPeerToPeer} from "../peer-to-peer/DataTypesPeerToPeer.sol";
import {DataTypesPeerToPool} from "../peer-to-pool/DataTypesPeerToPool.sol";
import {Ownable} from "../Ownable.sol";
import {IMysoTokenManager} from "../interfaces/IMysoTokenManager.sol";

contract TestnetTokenManager is ERC20, Ownable, IMysoTokenManager {
    uint8 internal _decimals;
    address internal _vaultCompartmentVictim;
    address internal _vaultAddr;
    uint256 internal _borrowerReward;
    uint256 internal _lenderReward;
    uint256 internal _vaultCreationReward;
    uint256 internal constant MAX_SUPPLY = 100_000_000 ether;

    constructor() ERC20("TYSO", "TYSO") Ownable() {
        _decimals = 18;
        _borrowerReward = 1 ether;
        _lenderReward = 1 ether;
        _vaultCreationReward = 1 ether;
    }

    function processP2PBorrow(
        uint256 currProtocolFee,
        DataTypesPeerToPeer.BorrowTransferInstructions
            calldata /*borrowInstructions*/,
        DataTypesPeerToPeer.Loan calldata loan,
        address lenderVault
    ) external returns (uint256 applicableProtocolFee) {
        applicableProtocolFee = currProtocolFee;
        if (totalSupply() + _borrowerReward + _lenderReward < MAX_SUPPLY) {
            _mint(loan.borrower, _borrowerReward);
            _mint(lenderVault, _lenderReward);
        }
    }

    function processP2PCreateVault(
        uint256 /*numRegisteredVaults*/,
        address /*vaultCreator*/,
        address newLenderVaultAddr
    ) external {
        _mint(newLenderVaultAddr, _vaultCreationReward);
    }

    function processP2PCreateWrappedTokenForERC721s(
        address /*tokenCreator*/,
        DataTypesPeerToPeer.WrappedERC721TokenInfo[]
            calldata /*tokensToBeWrapped*/
    ) external {}

    function processP2PCreateWrappedTokenForERC20s(
        address /*tokenCreator*/,
        DataTypesPeerToPeer.WrappedERC20TokenInfo[]
            calldata /*tokensToBeWrapped*/
    ) external {}

    function processP2PoolDeposit(
        address /*fundingPool*/,
        address /*depositor*/,
        uint256 /*depositAmount*/,
        uint256 /*transferFee*/
    ) external {}

    function processP2PoolSubscribe(
        address /*fundingPool*/,
        address /*subscriber*/,
        address /*loanProposal*/,
        uint256 /*subscriptionAmount*/,
        uint256 /*totalSubscriptions*/,
        DataTypesPeerToPool.LoanTerms calldata /*loanTerms*/
    ) external {}

    function processP2PoolLoanFinalization(
        address /*loanProposal*/,
        address /*fundingPool*/,
        address /*collToken*/,
        address /*arranger*/,
        address /*borrower*/,
        uint256 /*finalLoanAmount*/,
        uint256 /*finalCollAmountReservedForDefault*/,
        uint256 /*finalCollAmountReservedForConversions*/
    ) external {}

    function processP2PoolCreateLoanProposal(
        address /*fundingPool*/,
        address /*proposalCreator*/,
        address /*collToken*/,
        uint256 /*arrangerFee*/,
        uint256 /*numLoanProposals*/
    ) external {}

    function setRewards(
        uint256 borrowerReward,
        uint256 lenderReward,
        uint256 vaultCreationReward
    ) external {
        _senderCheckOwner();
        _borrowerReward = borrowerReward;
        _lenderReward = lenderReward;
        _vaultCreationReward = vaultCreationReward;
    }

    function owner() external view override returns (address) {
        return _owner;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
