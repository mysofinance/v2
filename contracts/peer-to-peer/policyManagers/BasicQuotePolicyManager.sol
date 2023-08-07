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
    mapping(address => mapping(address => mapping(address => DataTypesBasicPolicies.SinglePolicy)))
        public singleQuotingPolicies;
    mapping(address => DataTypesBasicPolicies.GlobalPolicy)
        public globalQuotingPolicies;
    mapping(address => mapping(address => mapping(address => bool)))
        public hasSingleQuotingPolicy;
    address public immutable addressRegistry;

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    function setGlobalPolicy(
        address lenderVault,
        bytes calldata globalPolicyData
    ) external {
        // @dev: global policy applies across all pairs
        _checkIsVaultAndSenderIsOwner(lenderVault);
        if (globalPolicyData.length > 0) {
            DataTypesBasicPolicies.GlobalPolicy memory globalPolicy = abi
                .decode(
                    globalPolicyData,
                    (DataTypesBasicPolicies.GlobalPolicy)
                );
            _checkQuoteBounds(globalPolicy.quoteBounds);
            globalQuotingPolicies[lenderVault] = globalPolicy;
        } else {
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
        _checkIsVaultAndSenderIsOwner(lenderVault);
        if (collToken == address(0) || loanToken == address(0)) {
            revert Errors.InvalidAddress();
        }
        mapping(address => bool)
            storage _hasSingleQuotingPolicy = hasSingleQuotingPolicy[
                lenderVault
            ][collToken];
        if (pairPolicyData.length > 0) {
            if (_hasSingleQuotingPolicy[loanToken]) {
                revert Errors.PolicyAlreadySet();
            }
            DataTypesBasicPolicies.SinglePolicy memory singlePolicy = abi
                .decode(pairPolicyData, (DataTypesBasicPolicies.SinglePolicy));
            _checkQuoteBounds(singlePolicy.quoteBounds);
            _hasSingleQuotingPolicy[loanToken] = true;
            singleQuotingPolicies[lenderVault][collToken][
                loanToken
            ] = singlePolicy;
        } else {
            if (!_hasSingleQuotingPolicy[loanToken]) {
                revert Errors.NoPolicyToDelete();
            }
            delete _hasSingleQuotingPolicy[loanToken];
            delete singleQuotingPolicies[lenderVault][collToken][loanToken];
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
        bool hasSinglePolicy = hasSingleQuotingPolicy[lenderVault][
            generalQuoteInfo.collToken
        ][generalQuoteInfo.loanToken];
        if (!globalPolicy.allowAllPairs && !hasSinglePolicy) {
            return (false, minNumOfSignersOverwrite);
        }

        // @dev: single quoting policy takes precedence over global quoting policy
        bool noOracle = generalQuoteInfo.oracleAddr == address(0);
        if (hasSinglePolicy) {
            DataTypesBasicPolicies.SinglePolicy
                memory singlePolicy = singleQuotingPolicies[lenderVault][
                    generalQuoteInfo.collToken
                ][generalQuoteInfo.loanToken];
            if (singlePolicy.requiresOracle && noOracle) {
                return (false, minNumOfSignersOverwrite);
            }
            return (
                _isQuoteTupleInBounds(
                    singlePolicy.quoteBounds,
                    quoteTuple,
                    true
                ),
                singlePolicy.minNumOfSignersOverwrite
            );
        } else {
            return (
                _isQuoteTupleInBounds(
                    globalPolicy.quoteBounds,
                    quoteTuple,
                    noOracle
                ),
                minNumOfSignersOverwrite
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

    function _checkQuoteBounds(
        DataTypesBasicPolicies.QuoteBounds memory quoteBounds
    ) internal pure {
        if (
            quoteBounds.minTenor <
            Constants.MIN_TIME_BETWEEN_EARLIEST_REPAY_AND_EXPIRY ||
            quoteBounds.minTenor > quoteBounds.maxTenor
        ) {
            revert Errors.InvalidTenors();
        }
        if (
            quoteBounds.minLoanPerCollUnitOrLtv >
            quoteBounds.maxLoanPerCollUnitOrLtv
        ) {
            revert Errors.InvalidLoanPerCollOrLtv();
        }
    }

    function _isQuoteTupleInBounds(
        DataTypesBasicPolicies.QuoteBounds memory quoteBounds,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple,
        bool checkLoanPerCollUnitOrLtv
    ) internal pure returns (bool) {
        if (
            quoteTuple.tenor == 0 ||
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

        if (
            quoteTuple.interestRatePctInBase < 0 ||
            Math.mulDiv(
                SafeCast.toUint256(quoteTuple.interestRatePctInBase),
                Constants.YEAR_IN_SECONDS,
                quoteTuple.tenor
            ) <
            quoteBounds.minAPR
        ) {
            return false;
        }

        if (quoteTuple.upfrontFeePctInBase < quoteBounds.minFee) {
            return false;
        }

        return true;
    }
}
