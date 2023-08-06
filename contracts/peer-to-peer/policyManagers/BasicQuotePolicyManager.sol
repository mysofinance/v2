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

contract BasicQuotePolicyManager is IQuotePolicyManager {
    mapping(address => mapping(address => mapping(address => bytes)))
        public quotingPolicies;
    mapping(address => mapping(address => mapping(address => bool)))
        public isPairAllowed;
    address public immutable addressRegistry;

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    function setAllowedPairAndPolicy(
        address lenderVault,
        address collToken,
        address loanToken,
        bytes calldata policyData
    ) external {
        _checkIsVaultAndSenderIsOwner(lenderVault);
        if (isPairAllowed[lenderVault][collToken][loanToken]) {
            revert Errors.PolicyAlreadySet();
        }
        (
            ,
            /*bool requiresOracle*/ uint40 minTenor,
            uint40 maxTenor /*uint64 minFee*/ /*uint80 minAPR*/,
            ,
            ,
            uint128 minLoanPerCollUnitOrLtv,
            uint128 maxLoanPerCollUnitOrLtv
        ) = abi.decode(
                policyData,
                (bool, uint40, uint40, uint64, uint80, uint128, uint128)
            );
        if (
            minTenor < Constants.MIN_TIME_BETWEEN_EARLIEST_REPAY_AND_EXPIRY ||
            minTenor > maxTenor
        ) {
            revert Errors.InvalidTenors();
        }
        if (minLoanPerCollUnitOrLtv > maxLoanPerCollUnitOrLtv) {
            revert Errors.InvalidLoanPerCollOrLtv();
        }
        isPairAllowed[lenderVault][collToken][loanToken] = true;
        quotingPolicies[lenderVault][collToken][loanToken] = policyData;
        emit PolicySet(lenderVault, collToken, loanToken, policyData);
    }

    function deleteAllowedPairAndPolicy(
        address lenderVault,
        address collToken,
        address loanToken
    ) external {
        _checkIsVaultAndSenderIsOwner(lenderVault);
        if (!isPairAllowed[lenderVault][collToken][loanToken]) {
            revert Errors.NoPolicyToDelete();
        }
        delete isPairAllowed[lenderVault][collToken][loanToken];
        delete quotingPolicies[lenderVault][collToken][loanToken];
        emit PolicyDeleted(lenderVault, collToken, loanToken);
    }

    function isAllowed(
        address /*borrower*/,
        address lenderVault,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    ) external view returns (bool _isAllowed) {
        if (
            !isPairAllowed[lenderVault][generalQuoteInfo.collToken][
                generalQuoteInfo.loanToken
            ]
        ) {
            return false;
        }

        (
            bool requiresOracle,
            uint40 minTenor,
            uint40 maxTenor,
            uint64 minFee,
            uint80 minAPR,
            uint128 minLoanPerCollUnitOrLtv,
            uint128 maxLoanPerCollUnitOrLtv
        ) = abi.decode(
                quotingPolicies[lenderVault][generalQuoteInfo.collToken][
                    generalQuoteInfo.loanToken
                ],
                (bool, uint40, uint40, uint64, uint80, uint128, uint128)
            );
        if (requiresOracle && generalQuoteInfo.oracleAddr == address(0)) {
            return false;
        }

        if (
            quoteTuple.tenor == 0 ||
            quoteTuple.tenor < minTenor ||
            quoteTuple.tenor > maxTenor
        ) {
            return false;
        }

        if (
            quoteTuple.loanPerCollUnitOrLtv < minLoanPerCollUnitOrLtv ||
            quoteTuple.loanPerCollUnitOrLtv > maxLoanPerCollUnitOrLtv
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
            minAPR
        ) {
            return false;
        }

        if (quoteTuple.upfrontFeePctInBase < minFee) {
            return false;
        }

        return true;
    }

    function _checkIsVaultAndSenderIsOwner(address lenderVault) internal view {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
    }
}
