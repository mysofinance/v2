// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../peer-to-peer/DataTypesPeerToPeer.sol";
import {IQuotePolicyManager} from "../peer-to-peer/interfaces/IQuotePolicyManager.sol";

contract TestQuotePolicyManager is IQuotePolicyManager {
    mapping(address => bool) public allow;

    // solhint-disable-next-line no-empty-blocks
    constructor() {}

    function updatePolicy(address lenderVault, bool _allow) external {
        allow[lenderVault] = _allow;
    }

    function borrowViolatesPolicy(
        address,
        address lenderVault,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata,
        DataTypesPeerToPeer.QuoteTuple calldata,
        bool
    ) external view returns (bool _borrowViolatesPolicy) {
        _borrowViolatesPolicy = !allow[lenderVault];
    }
}
