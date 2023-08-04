// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {DataTypesPeerToPeer} from "../DataTypesPeerToPeer.sol";
import {Constants} from "../../Constants.sol";
import {Errors} from "../../Errors.sol";
import {IAddressRegistry} from "../interfaces/IAddressRegistry.sol";
import {ILenderVaultImpl} from "../interfaces/ILenderVaultImpl.sol";
import {IQuotePolicyManager} from "../interfaces/IQuotePolicyManager.sol";
import {ISimpleQuotePolicyManager} from "./interfaces/ISimpleQuotePolicyManager.sol";

contract SimpleQuotePolicyManager is
    IQuotePolicyManager,
    ISimpleQuotePolicyManager
{
    mapping(address => DataTypesPeerToPeer.DefaultPolicyState)
        public defaultRulesWhenNoPolicySet;
    mapping(address => mapping(address => mapping(address => DataTypesPeerToPeer.SimplePolicy)))
        public policies;
    address public immutable addressRegistry;

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    function setPolicyForPair(
        address lenderVault,
        address collToken,
        address loanToken,
        DataTypesPeerToPeer.SimplePolicy calldata policy
    ) external {
        _checkIsRegisteredVaultAndSenderIsApproved(lenderVault);
        _isValidPolicy(policy);
        policies[lenderVault][collToken][loanToken] = policy;
        emit PolicySet(lenderVault, collToken, loanToken, policy);
    }

    function deletePolicyForPair(
        address lenderVault,
        address collToken,
        address loanToken
    ) external {
        _checkIsRegisteredVaultAndSenderIsApproved(lenderVault);
        mapping(address => DataTypesPeerToPeer.SimplePolicy)
            storage policiesForVaultAndCollToken = policies[lenderVault][
                collToken
            ];
        if (!policiesForVaultAndCollToken[loanToken].isSet) {
            revert Errors.PolicyNotSet();
        }
        delete policiesForVaultAndCollToken[loanToken];
        emit PolicyDeleted(lenderVault, collToken, loanToken);
    }

    function setDefaultPolicy(
        address lenderVault,
        DataTypesPeerToPeer.DefaultPolicyState defaultPolicyState
    ) external {
        _checkIsRegisteredVaultAndSenderIsApproved(lenderVault);
        defaultRulesWhenNoPolicySet[lenderVault] = defaultPolicyState;
        emit DefaultPolicySet(lenderVault, defaultPolicyState);
    }

    function borrowViolatesPolicy(
        address,
        address lenderVault,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple,
        bool isOnChainQuote
    )
        external
        view
        returns (bool _borrowViolatesPolicy, uint256 _minSignersForThisPolicy)
    {
        DataTypesPeerToPeer.SimplePolicy memory policy = policies[lenderVault][
            generalQuoteInfo.collToken
        ][generalQuoteInfo.loanToken];
        // this will only affect off chain quotes once returned to the quote handler
        // @dev: quote handler will handle a return value of 0, so no need for special handling here
        _minSignersForThisPolicy = policy.isSet && !isOnChainQuote
            ? policy.minNumSigners
            : 0;
        bool doesPolicyApplyToThisQuote = policy.isSet
            ? _doesPolicyApplyToThisQuote(policy.policyType, isOnChainQuote)
            : false;
        if (!doesPolicyApplyToThisQuote) {
            _borrowViolatesPolicy = _checkDefaultPolicy(
                lenderVault,
                isOnChainQuote
            );
        } else {
            _borrowViolatesPolicy = _checkPolicy(
                policy,
                generalQuoteInfo,
                quoteTuple
            );
        }
    }

    function _checkDefaultPolicy(
        address lenderVault,
        bool isOnChainQuote
    ) internal view returns (bool _borrowViolatesPolicy) {
        DataTypesPeerToPeer.DefaultPolicyState defaultPolicyState = defaultRulesWhenNoPolicySet[
                lenderVault
            ];
        // check three cases where violations could occur, else by default no violation
        if (
            defaultPolicyState ==
            DataTypesPeerToPeer.DefaultPolicyState.DISALLOW_ALL
        ) {
            _borrowViolatesPolicy = true;
        } else if (
            defaultPolicyState ==
            DataTypesPeerToPeer.DefaultPolicyState.ALLOW_ONLY_ON_CHAIN_QUOTES &&
            !isOnChainQuote
        ) {
            _borrowViolatesPolicy = true;
        } else if (
            defaultPolicyState ==
            DataTypesPeerToPeer
                .DefaultPolicyState
                .ALLOW_ONLY_OFF_CHAIN_QUOTES &&
            isOnChainQuote
        ) {
            _borrowViolatesPolicy = true;
        }
    }

    function _checkIsRegisteredVaultAndSenderIsApproved(
        address lenderVault
    ) internal view {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
    }

    // note: off chain quotes are allowed to leave _minNumSignersForThisPolicy as 0
    // since the quote handler will just always use the vault min num signers in that case
    function _checkPolicy(
        DataTypesPeerToPeer.SimplePolicy memory policy,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    ) internal pure returns (bool _borrowViolatesPolicy) {
        if (
            policy.requiresOracle && generalQuoteInfo.oracleAddr == address(0)
        ) {
            _borrowViolatesPolicy = true;
        } else if (
            quoteTuple.tenor == 0 ||
            quoteTuple.tenor < policy.minTenor ||
            quoteTuple.tenor > policy.maxTenor
        ) {
            _borrowViolatesPolicy = true;
        } else if (
            quoteTuple.loanPerCollUnitOrLtv <
            policy.minAllowableLoanPerCollUnitOrLtv ||
            quoteTuple.loanPerCollUnitOrLtv >
            policy.maxAllowableLoanPerCollUnitOrLtv
        ) {
            _borrowViolatesPolicy = true;
        } else if (
            quoteTuple.interestRatePctInBase < 0 ||
            Math.mulDiv(
                SafeCast.toUint256(quoteTuple.interestRatePctInBase),
                Constants.YEAR_IN_SECONDS,
                quoteTuple.tenor
            ) <
            policy.minAPR
        ) {
            _borrowViolatesPolicy = true;
        } else if (quoteTuple.upfrontFeePctInBase < policy.minFee) {
            _borrowViolatesPolicy = true;
        }
    }

    function _doesPolicyApplyToThisQuote(
        DataTypesPeerToPeer.PolicyType policyType,
        bool isOnChainQuote
    ) internal pure returns (bool) {
        return
            policyType == DataTypesPeerToPeer.PolicyType.ALL_QUOTES ||
            (policyType ==
                DataTypesPeerToPeer.PolicyType.ONLY_ON_CHAIN_QUOTES &&
                isOnChainQuote) ||
            (policyType ==
                DataTypesPeerToPeer.PolicyType.ONLY_OFF_CHAIN_QUOTES &&
                !isOnChainQuote);
    }

    function _isValidPolicy(
        DataTypesPeerToPeer.SimplePolicy calldata policy
    ) internal pure {
        if (!policy.isSet) {
            revert Errors.PolicyNotSet();
        }
        if (policy.minTenor > policy.maxTenor) {
            revert Errors.InvalidTenors();
        }
        if (
            policy.minAllowableLoanPerCollUnitOrLtv >
            policy.maxAllowableLoanPerCollUnitOrLtv
        ) {
            revert Errors.InvalidLoanPerCollOrLTV();
        }
    }
}
