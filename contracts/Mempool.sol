pragma solidity 0.8.17;
import "hardhat/console.sol";

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Vault} from "./Vault.sol";

struct LoanRequest { 
   address borrower;
   address collToken;
   address loanToken;
   uint256 expiry;
   uint256 pledgeAmount;
   uint256 loanAmount;
   uint256 repayAmount;
   uint256 validUntil;
   uint256 nonce;
}

contract Mempool {
    using SafeERC20 for IERC20Metadata;

    error InvalidPull();

    mapping(address => mapping(address => uint256)) public deposits;
    mapping(address => uint256) public nonce;

    function deposit(address token, uint256 amount) external {
        IERC20Metadata(token).safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender][token] += amount;
    }

    function withdraw(address token, uint256 amount) external {
        IERC20Metadata(token).safeTransfer(msg.sender, amount);
        deposits[msg.sender][token] -= amount;
    }

    function executeLoanRequest(LoanRequest calldata loanRequest, address takerVault, uint8 _v, bytes32 _r, bytes32 _s) external {
        bytes32 payloadHash = keccak256(abi.encode(loanRequest.borrower, loanRequest.collToken, loanRequest.loanToken, loanRequest.expiry, loanRequest.pledgeAmount, loanRequest.loanAmount, loanRequest.repayAmount, loanRequest.validUntil, loanRequest.nonce));
        bytes32 messageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash));
        address signer = ecrecover(messageHash, _v, _r, _s);
        if (signer != loanRequest.borrower) {
            revert InvalidPull();
        }
        if (block.timestamp > loanRequest.validUntil) {
            revert InvalidPull();
        }
        if (loanRequest.nonce != nonce[loanRequest.borrower] + 1) {
            revert InvalidPull();
        }
        if (msg.sender != Vault(takerVault).owner()) {
            revert InvalidPull();
        }
        IERC20Metadata(loanRequest.collToken).safeTransfer(takerVault, loanRequest.pledgeAmount);
        IERC20Metadata(loanRequest.loanToken).safeTransferFrom(takerVault, loanRequest.borrower, loanRequest.loanAmount);
        deposits[loanRequest.borrower][loanRequest.collToken] -= loanRequest.pledgeAmount;
        nonce[loanRequest.borrower] += 1;
        Vault(takerVault).executeLoanRequest(loanRequest);
    }
}