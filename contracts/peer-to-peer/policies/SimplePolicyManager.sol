// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {DataTypesPeerToPeer} from "../DataTypesPeerToPeer.sol";
import {Errors} from "../../Errors.sol";
import {IAddressRegistry} from "../interfaces/IAddressRegistry.sol";
import {ILenderVaultImpl} from "../interfaces/ILenderVaultImpl.sol";
import {IQuotePolicyManager} from "../interfaces/IQuotePolicyManager.sol";

contract SimplePolicyManager is IQuotePolicyManager {
    struct Policy {
        // check if policy is set
        bool isSet;
        // requires oracle
        bool requiresOracle;
        // is policy for all quotes, on chain quotes only, or off chain quotes only
        DataTypesPeerToPeer.PolicyType policyType;
        // min signers for this policy if off chain quote
        // if 0, then quote handler will use vault min num signers
        // if > 0, then quote handler will use this value
        // this is convenient for automated quotes or RFQs. e.g., lender only wants 1 key
        // for quotes covered by policy, but vault requires more signers for pairs without policies
        uint8 minNumSigners;
        // min allowable tenor
        uint40 minTenor;
        // max allowable tenor
        uint40 maxTenor;
        // global min fee
        uint64 minFee;
        // global min apr
        uint80 minAPR;
        // min allowable LTV or loan per collateral amount
        uint128 minAllowableLTVorLoanPerColl;
        // max allowbale LTV or loan per collateral amount
        uint128 maxAllowableLTVorLoanPerColl;
    }

    mapping(address => DataTypesPeerToPeer.DefaultPolicyState)
        public defaultRulesWhenNoPolicySet;
    mapping(address => mapping(address => mapping(address => Policy)))
        internal policies;
    address public immutable addressRegistry;

    event PolicySet(
        address indexed lenderVault,
        address indexed collToken,
        address indexed loanToken,
        Policy policy
    );

    error PolicyNotSet();
    error InvalidTenors();
    error MinLTVGreaterThanMaxLTV();

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    function setPolicyForPair(
        address lenderVault,
        address collToken,
        address loanToken,
        Policy calldata policy
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
        delete policies[lenderVault][collToken][loanToken];
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
        Policy memory policy = policies[lenderVault][
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
            _borrowViolatesPolicy = _checkDefaultPolicy(isOnChainQuote);
        } else {
            _borrowViolatesPolicy = _checkPolicy(
                policy,
                generalQuoteInfo,
                quoteTuple
            );
        }
    }

    function _checkDefaultPolicy(
        bool isOnChainQuote
    ) internal view returns (bool _borrowViolatesPolicy) {
        DataTypesPeerToPeer.DefaultPolicyState defaultPolicyState = defaultRulesWhenNoPolicySet[
                msg.sender
            ];
        if (
            defaultPolicyState ==
            DataTypesPeerToPeer.DefaultPolicyState.ALLOW_ALL
        ) {
            _borrowViolatesPolicy = false;
        } else if (
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
        Policy memory policy,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    ) internal pure returns (bool _borrowViolatesPolicy) {
        if (
            policy.requiresOracle && generalQuoteInfo.oracleAddr == address(0)
        ) {
            _borrowViolatesPolicy = true;
        } else if (
            quoteTuple.tenor < policy.minTenor ||
            quoteTuple.tenor > policy.maxTenor
        ) {
            _borrowViolatesPolicy = true;
        } else if (
            quoteTuple.loanPerCollUnitOrLtv <
            policy.minAllowableLTVorLoanPerColl ||
            quoteTuple.loanPerCollUnitOrLtv >
            policy.maxAllowableLTVorLoanPerColl
        ) {
            _borrowViolatesPolicy = true;
        } else if (
            SafeCast.toUint256(quoteTuple.interestRatePctInBase) < policy.minAPR
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

    function _isValidPolicy(Policy calldata policy) internal pure {
        if (!policy.isSet) {
            revert PolicyNotSet();
        }
        if (policy.minTenor > policy.maxTenor) {
            revert InvalidTenors();
        }
        if (
            policy.minAllowableLTVorLoanPerColl >
            policy.maxAllowableLTVorLoanPerColl
        ) {
            revert MinLTVGreaterThanMaxLTV();
        }
    }
}
