// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {DataTypesPeerToPeer} from "../DataTypesPeerToPeer.sol";
import {DataTypesBasicPolicies} from "./DataTypesBasicPolicies.sol";
import {Constants} from "../../Constants.sol";
import {Errors} from "../../Errors.sol";
import {IAddressRegistry} from "../interfaces/IAddressRegistry.sol";
import {ILenderVaultImpl} from "../interfaces/ILenderVaultImpl.sol";
import {IQuotePolicyManager} from "../interfaces/IQuotePolicyManager.sol";

contract BasicQuotePolicyManager is IQuotePolicyManager {
    mapping(address => DataTypesBasicPolicies.GlobalPolicy)
        public globalQuotingPolicies;
    mapping(address => mapping(address => mapping(address => DataTypesBasicPolicies.PairPolicy)))
        public pairQuotingPolicies;
    mapping(address => bool) public hasGlobalQuotingPolicy;
    mapping(address => mapping(address => mapping(address => bool)))
        public hasPairQuotingPolicy;
    address public immutable addressRegistry;

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    function setGlobalPolicy(
        address lenderVault,
        bytes calldata globalPolicyData
    ) external {
        // @dev: global policy applies across all pairs;
        // note: pair policies (if defined) take precedence over global policy
        _checkIsVaultAndSenderIsOwner(lenderVault);
        if (globalPolicyData.length > 0) {
            DataTypesBasicPolicies.GlobalPolicy memory globalPolicy = abi
                .decode(
                    globalPolicyData,
                    (DataTypesBasicPolicies.GlobalPolicy)
                );
            DataTypesBasicPolicies.GlobalPolicy
                memory currGlobalPolicy = globalQuotingPolicies[lenderVault];
            if (
                globalPolicy.allowAllPairs == currGlobalPolicy.allowAllPairs &&
                _equalQuoteBounds(
                    globalPolicy.quoteBounds,
                    currGlobalPolicy.quoteBounds
                )
            ) {
                revert Errors.PolicyAlreadySet();
            }
            _checkNewQuoteBounds(globalPolicy.quoteBounds);
            if (!hasGlobalQuotingPolicy[lenderVault]) {
                hasGlobalQuotingPolicy[lenderVault] = true;
            }
            globalQuotingPolicies[lenderVault] = globalPolicy;
        } else {
            if (!hasGlobalQuotingPolicy[lenderVault]) {
                revert Errors.NoPolicyToDelete();
            }
            delete hasGlobalQuotingPolicy[lenderVault];
            delete globalQuotingPolicies[lenderVault];
        }
        emit GlobalPolicySet(lenderVault, globalPolicyData);
    }

    function setPairPolicy(
        address lenderVault,
        address collToken,
        address loanToken,
        bytes calldata pairPolicyData
    ) external {
        // @dev: pair policies (if defined) take precedence over global policy
        _checkIsVaultAndSenderIsOwner(lenderVault);
        if (collToken == address(0) || loanToken == address(0)) {
            revert Errors.InvalidAddress();
        }
        mapping(address => bool)
            storage _hasSingleQuotingPolicy = hasPairQuotingPolicy[lenderVault][
                collToken
            ];
        if (pairPolicyData.length > 0) {
            DataTypesBasicPolicies.PairPolicy memory singlePolicy = abi.decode(
                pairPolicyData,
                (DataTypesBasicPolicies.PairPolicy)
            );
            DataTypesBasicPolicies.PairPolicy
                memory currSinglePolicy = pairQuotingPolicies[lenderVault][
                    collToken
                ][loanToken];
            if (
                singlePolicy.requiresOracle ==
                currSinglePolicy.requiresOracle &&
                singlePolicy.minNumOfSignersOverwrite ==
                currSinglePolicy.minNumOfSignersOverwrite &&
                _equalQuoteBounds(
                    singlePolicy.quoteBounds,
                    currSinglePolicy.quoteBounds
                )
            ) {
                revert Errors.PolicyAlreadySet();
            }
            _checkNewQuoteBounds(singlePolicy.quoteBounds);
            if (!_hasSingleQuotingPolicy[loanToken]) {
                _hasSingleQuotingPolicy[loanToken] = true;
            }
            pairQuotingPolicies[lenderVault][collToken][
                loanToken
            ] = singlePolicy;
        } else {
            if (!_hasSingleQuotingPolicy[loanToken]) {
                revert Errors.NoPolicyToDelete();
            }
            delete _hasSingleQuotingPolicy[loanToken];
            delete pairQuotingPolicies[lenderVault][collToken][loanToken];
        }
        emit PairPolicySet(lenderVault, collToken, loanToken, pairPolicyData);
    }

    function isAllowed(
        address /*borrower*/,
        address lenderVault,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    )
        external
        view
        returns (bool _isAllowed, uint256 minNumOfSignersOverwrite)
    {
        DataTypesBasicPolicies.GlobalPolicy
            memory globalPolicy = globalQuotingPolicies[lenderVault];
        bool hasSinglePolicy = hasPairQuotingPolicy[lenderVault][
            generalQuoteInfo.collToken
        ][generalQuoteInfo.loanToken];
        if (!globalPolicy.allowAllPairs && !hasSinglePolicy) {
            return (false, 0);
        }

        // @dev: pair policy (if defined) takes precedence over global policy
        bool hasOracle = generalQuoteInfo.oracleAddr != address(0);
        if (hasSinglePolicy) {
            DataTypesBasicPolicies.PairPolicy
                memory singlePolicy = pairQuotingPolicies[lenderVault][
                    generalQuoteInfo.collToken
                ][generalQuoteInfo.loanToken];
            if (singlePolicy.requiresOracle && !hasOracle) {
                return (false, 0);
            }
            return (
                _isAllowedWithBounds(
                    singlePolicy.quoteBounds,
                    quoteTuple,
                    generalQuoteInfo.earliestRepayTenor,
                    true
                ),
                singlePolicy.minNumOfSignersOverwrite
            );
        } else {
            // @dev: check against global min/max loanPerCollUnitOrLtv only if pair has oracle
            return (
                _isAllowedWithBounds(
                    globalPolicy.quoteBounds,
                    quoteTuple,
                    generalQuoteInfo.earliestRepayTenor,
                    hasOracle
                ),
                0
            );
        }
    }

    function _checkIsVaultAndSenderIsOwner(address lenderVault) internal view {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
    }

    function _equalQuoteBounds(
        DataTypesBasicPolicies.QuoteBounds memory quoteBounds1,
        DataTypesBasicPolicies.QuoteBounds memory quoteBounds2
    ) internal pure returns (bool isEqual) {
        if (
            quoteBounds1.minTenor == quoteBounds2.minTenor &&
            quoteBounds1.maxTenor == quoteBounds2.maxTenor &&
            quoteBounds1.minFee == quoteBounds2.minFee &&
            quoteBounds1.minApr == quoteBounds2.minApr &&
            quoteBounds1.minLoanPerCollUnitOrLtv ==
            quoteBounds2.minLoanPerCollUnitOrLtv &&
            quoteBounds1.maxLoanPerCollUnitOrLtv ==
            quoteBounds2.maxLoanPerCollUnitOrLtv
        ) {
            isEqual = true;
        }
    }

    function _checkNewQuoteBounds(
        DataTypesBasicPolicies.QuoteBounds memory quoteBounds
    ) internal pure {
        // @dev: allow minTenor == 0 to enable swaps
        if (quoteBounds.minTenor > quoteBounds.maxTenor) {
            revert Errors.InvalidTenors();
        }
        if (
            quoteBounds.minLoanPerCollUnitOrLtv >
            quoteBounds.maxLoanPerCollUnitOrLtv
        ) {
            revert Errors.InvalidLoanPerCollOrLtv();
        }
        if (quoteBounds.minApr + int(Constants.BASE) <= 0) {
            revert Errors.InvalidMinApr();
        }
    }

    function _isAllowedWithBounds(
        DataTypesBasicPolicies.QuoteBounds memory quoteBounds,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple,
        uint256 earliestRepayTenor,
        bool checkLoanPerCollUnitOrLtv
    ) internal pure returns (bool) {
        if (
            quoteTuple.tenor < quoteBounds.minTenor ||
            quoteTuple.tenor > quoteBounds.maxTenor
        ) {
            return false;
        }

        if (
            checkLoanPerCollUnitOrLtv &&
            (quoteTuple.loanPerCollUnitOrLtv <
                quoteBounds.minLoanPerCollUnitOrLtv ||
                quoteTuple.loanPerCollUnitOrLtv >
                quoteBounds.maxLoanPerCollUnitOrLtv)
        ) {
            return false;
        }

        int256 apr = (quoteTuple.interestRatePctInBase *
            SafeCast.toInt256(Constants.YEAR_IN_SECONDS)) /
            SafeCast.toInt256(quoteTuple.tenor);
        // @dev: disallow negative apr and where earliest repay is zero
        if ((apr < 0 && earliestRepayTenor == 0) || apr < quoteBounds.minApr) {
            return false;
        }

        if (quoteTuple.upfrontFeePctInBase < quoteBounds.minFee) {
            return false;
        }

        return true;
    }
}
