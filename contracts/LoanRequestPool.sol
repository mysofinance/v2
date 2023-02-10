// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {DataTypes} from "./DataTypes.sol";
import {LenderVault} from "./LenderVault.sol";

contract LoanRequestPool is ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;
    /*
    mapping(address => bool) public isAcceptedToken;
    mapping(address => uint256) public myLoanRequestId;
    DataTypes.LoanRequest[] public openLoanRequests;

    constructor() {}

    function addRequest(
        DataTypes.LoanRequest memory loanRequest
    ) external nonReentrant {
        if (
            myLoanRequestId[msg.sender] == 0 ||
            !isAcceptedToken[loanRequest.collToken] ||
            !isAcceptedToken[loanRequest.loanToken] ||
            loanRequest.collToken == loanRequest.loanToken
        ) {
            revert();
        }
        uint256 balBefore = IERC20Metadata(loanRequest.collToken).balanceOf(
            address(this)
        );
        IERC20Metadata(loanRequest.collToken).safeTransferFrom(
            msg.sender,
            address(this),
            loanRequest.sendAmount
        );
        uint256 balAfter = IERC20Metadata(loanRequest.collToken).balanceOf(
            address(this)
        );
        if (balAfter < balBefore) {
            revert();
        }
        loanRequest.sendAmount = balAfter - balBefore;
        openLoanRequests.push(loanRequest);
        myLoanRequestId[msg.sender] = openLoanRequests.length;
    }

    function cancelRequest() external nonReentrant {
        if (myLoanRequestId[msg.sender] == 0) {
            revert();
        }
        uint256 reassignId = myLoanRequestId[msg.sender] - 1;

        DataTypes.LoanRequest memory cancelLoanRequest = openLoanRequests[
            reassignId
        ];
        DataTypes.LoanRequest memory keepLoanRequest = openLoanRequests[
            openLoanRequests.length - 1
        ];

        openLoanRequests[reassignId] = keepLoanRequest;
        myLoanRequestId[keepLoanRequest.borrower] = reassignId;
        myLoanRequestId[msg.sender] = 0;
        openLoanRequests.pop();

        uint256 collTokenBalBefore = IERC20Metadata(cancelLoanRequest.collToken)
            .balanceOf(address(this));
        IERC20Metadata(cancelLoanRequest.collToken).safeTransfer(
            msg.sender,
            cancelLoanRequest.sendAmount
        );
        uint256 collTokenBalAfter = IERC20Metadata(cancelLoanRequest.collToken)
            .balanceOf(address(this));
        if (
            collTokenBalBefore - collTokenBalAfter !=
            cancelLoanRequest.sendAmount
        ) {
            revert();
        }
    }

    function updateRequest(
        DataTypes.LoanRequest memory updatedLoanRequest
    ) external nonReentrant {
        uint256 updateLoanRequestId = myLoanRequestId[msg.sender];
        if (updateLoanRequestId == 0) {
            revert();
        }

        DataTypes.LoanRequest memory oldLoanRequest = openLoanRequests[
            updateLoanRequestId
        ];
        if (
            oldLoanRequest.collToken != updatedLoanRequest.collToken ||
            oldLoanRequest.loanToken != updatedLoanRequest.loanToken ||
            oldLoanRequest.sendAmount != updatedLoanRequest.sendAmount
        ) {
            revert();
        }
        openLoanRequests[updateLoanRequestId] = updatedLoanRequest;
    }

    function executeRequest(
        uint256 loanRequestId,
        DataTypes.OffChainQuote calldata offChainQuote,
        address lenderVault
    ) external nonReentrant {
        if (loanRequestId > openLoanRequests.length - 1) {
            revert();
        }
        DataTypes.LoanRequest memory executeLoanRequest = openLoanRequests[
            loanRequestId
        ];
        if (
            executeLoanRequest.borrower != offChainQuote.borrower ||
            executeLoanRequest.collToken != offChainQuote.collToken ||
            executeLoanRequest.loanToken != offChainQuote.loanToken ||
            executeLoanRequest.sendAmount != offChainQuote.sendAmount ||
            executeLoanRequest.loanAmount != offChainQuote.loanAmount ||
            executeLoanRequest.expiry != offChainQuote.expiry ||
            executeLoanRequest.earliestRepay != offChainQuote.earliestRepay ||
            executeLoanRequest.repayAmount != offChainQuote.repayAmount ||
            executeLoanRequest.validUntil != offChainQuote.validUntil ||
            executeLoanRequest.upfrontFee != offChainQuote.upfrontFee
        ) {
            revert();
        }

        IERC20Metadata(executeLoanRequest.collToken).approve(
            lenderVault,
            executeLoanRequest.sendAmount
        );
        uint256 collTokenBalBefore = IERC20Metadata(
            executeLoanRequest.collToken
        ).balanceOf(address(this));
        uint256 loanTokenBalBefore = IERC20Metadata(
            executeLoanRequest.loanToken
        ).balanceOf(address(this));
        LenderVault(lenderVault).borrowWithOffChainQuote(
            offChainQuote,
            address(0),
            ""
        );
        IERC20Metadata(executeLoanRequest.collToken).approve(lenderVault, 0);
        uint256 collTokenBalAfter = IERC20Metadata(executeLoanRequest.collToken)
            .balanceOf(address(this));
        uint256 loanTokenBalAfter = IERC20Metadata(executeLoanRequest.loanToken)
            .balanceOf(address(this));
        if (
            collTokenBalBefore - collTokenBalAfter != offChainQuote.sendAmount
        ) {
            revert();
        }
        if (
            loanTokenBalAfter - loanTokenBalBefore != offChainQuote.loanAmount
        ) {
            revert();
        }
        IERC20Metadata(executeLoanRequest.loanToken).safeTransfer(
            executeLoanRequest.borrower,
            offChainQuote.loanAmount
        );
    }
    */
}
