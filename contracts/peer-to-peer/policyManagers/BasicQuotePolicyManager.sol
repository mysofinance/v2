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
import {IQuotePolicyManager} from "../interfaces/policyManagers/IQuotePolicyManager.sol";

contract BasicQuotePolicyManager is IQuotePolicyManager {
    mapping(address => DataTypesBasicPolicies.GlobalPolicy)
        internal _globalQuotingPolicies;
    mapping(address => mapping(address => mapping(address => DataTypesBasicPolicies.PairPolicy)))
        internal _pairQuotingPolicies;
    mapping(address => bool) internal _hasGlobalQuotingPolicy;
    mapping(address => mapping(address => mapping(address => bool)))
        internal _hasPairQuotingPolicy;
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
                memory currGlobalPolicy = _globalQuotingPolicies[lenderVault];
            if (
                globalPolicy.allowAllPairs == currGlobalPolicy.allowAllPairs &&
                globalPolicy.requiresOracle ==
                currGlobalPolicy.requiresOracle &&
                _equalQuoteBounds(
                    globalPolicy.quoteBounds,
                    currGlobalPolicy.quoteBounds
                )
            ) {
                revert Errors.PolicyAlreadySet();
            }
            _checkNewQuoteBounds(globalPolicy.quoteBounds);
            if (!_hasGlobalQuotingPolicy[lenderVault]) {
                _hasGlobalQuotingPolicy[lenderVault] = true;
            }
            _globalQuotingPolicies[lenderVault] = globalPolicy;
        } else {
            if (!_hasGlobalQuotingPolicy[lenderVault]) {
                revert Errors.NoPolicyToDelete();
            }
            delete _hasGlobalQuotingPolicy[lenderVault];
            delete _globalQuotingPolicies[lenderVault];
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
            storage _hasSingleQuotingPolicy = _hasPairQuotingPolicy[
                lenderVault
            ][collToken];
        if (pairPolicyData.length > 0) {
            DataTypesBasicPolicies.PairPolicy memory singlePolicy = abi.decode(
                pairPolicyData,
                (DataTypesBasicPolicies.PairPolicy)
            );
            DataTypesBasicPolicies.PairPolicy
                memory currSinglePolicy = _pairQuotingPolicies[lenderVault][
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
            _pairQuotingPolicies[lenderVault][collToken][
                loanToken
            ] = singlePolicy;
        } else {
            if (!_hasSingleQuotingPolicy[loanToken]) {
                revert Errors.NoPolicyToDelete();
            }
            delete _hasSingleQuotingPolicy[loanToken];
            delete _pairQuotingPolicies[lenderVault][collToken][loanToken];
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
            memory globalPolicy = _globalQuotingPolicies[lenderVault];
        bool hasPairPolicy = _hasPairQuotingPolicy[lenderVault][
            generalQuoteInfo.collToken
        ][generalQuoteInfo.loanToken];
        if (!globalPolicy.allowAllPairs && !hasPairPolicy) {
            return (false, 0);
        }

        // @dev: pair policy (if defined) takes precedence over global policy
        bool hasOracle = generalQuoteInfo.oracleAddr != address(0);
        bool requiresOracle;
        DataTypesBasicPolicies.QuoteBounds memory quoteBounds;
        bool checkLoanPerCollUnitOrLtv;
        if (hasPairPolicy) {
            DataTypesBasicPolicies.PairPolicy
                memory singlePolicy = _pairQuotingPolicies[lenderVault][
                    generalQuoteInfo.collToken
                ][generalQuoteInfo.loanToken];
            requiresOracle = singlePolicy.requiresOracle;
            quoteBounds = singlePolicy.quoteBounds;
            // @dev: in case of pair policy always check against min/max loanPerCollUnitOrLtv
            checkLoanPerCollUnitOrLtv = true;
            minNumOfSignersOverwrite = singlePolicy.minNumOfSignersOverwrite;
        } else {
            requiresOracle = globalPolicy.requiresOracle;
            quoteBounds = globalPolicy.quoteBounds;
            // @dev: in case of global policy, only check against global min/max loanPerCollUnitOrLtv if
            // pair has oracle
            checkLoanPerCollUnitOrLtv = hasOracle;
        }

        if (requiresOracle && !hasOracle) {
            return (false, 0);
        }

        return (
            _isAllowedWithBounds(
                quoteBounds,
                quoteTuple,
                generalQuoteInfo.earliestRepayTenor,
                checkLoanPerCollUnitOrLtv
            ),
            minNumOfSignersOverwrite
        );
    }

    function globalQuotingPolicy(
        address lenderVault
    ) external view returns (DataTypesBasicPolicies.GlobalPolicy memory) {
        if (!_hasGlobalQuotingPolicy[lenderVault]) {
            revert Errors.NoPolicy();
        }
        return _globalQuotingPolicies[lenderVault];
    }

    function pairQuotingPolicy(
        address lenderVault,
        address collToken,
        address loanToken
    ) external view returns (DataTypesBasicPolicies.PairPolicy memory) {
        if (!_hasPairQuotingPolicy[lenderVault][collToken][loanToken]) {
            revert Errors.NoPolicy();
        }
        return _pairQuotingPolicies[lenderVault][collToken][loanToken];
    }

    function hasGlobalQuotingPolicy(
        address lenderVault
    ) external view returns (bool) {
        return _hasGlobalQuotingPolicy[lenderVault];
    }

    function hasPairQuotingPolicy(
        address lenderVault,
        address collToken,
        address loanToken
    ) external view returns (bool) {
        return _hasPairQuotingPolicy[lenderVault][collToken][loanToken];
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

        // @dev: if tenor is zero tx is swap and no need to check apr
        if (quoteTuple.tenor > 0) {
            int256 apr = (quoteTuple.interestRatePctInBase *
                SafeCast.toInt256(Constants.YEAR_IN_SECONDS)) /
                SafeCast.toInt256(quoteTuple.tenor);
            if (apr < quoteBounds.minApr) {
                return false;
            }
            // @dev: disallow if negative apr and earliest repay is below bound
            if (
                apr < 0 &&
                earliestRepayTenor < quoteBounds.minEarliestRepayTenor
            ) {
                return false;
            }
        }

        if (quoteTuple.upfrontFeePctInBase < quoteBounds.minFee) {
            return false;
        }

        return true;
    }
}
