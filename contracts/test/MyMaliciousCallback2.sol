// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.19;

contract MyMaliciousCallback2 {
    address internal vaultVictim;
    address internal withdrawToken;
    uint256 internal withdrawAmount;

    constructor(
        address _vaultVictim,
        address _withdrawToken,
        uint256 _withdrawAmount
    ) {
        vaultVictim = _vaultVictim;
        withdrawToken = _withdrawToken;
        withdrawAmount = _withdrawAmount;
    }

    function balanceOf(address) external returns (uint256) {
        // Try hijacking control flow by calling back into vault and trying to withdraw again
        (bool success, bytes memory result) = vaultVictim.call(
            abi.encodeWithSignature(
                "withdraw(address,uint256)",
                withdrawToken,
                withdrawAmount
            )
        );
        /* The delegate call is expected to fail because of mutex in _withdrawCheck()
         * Note: even if there wasn't a _withdrawCheck() then delegate call and access check could be
         * bypassed, then delegate call would operate on the contract state and balance of MyMaliciousCallback1,
         * NOT on balance of vault, hence the vault balance wouldn't be at risk
         */
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function transfer(address, uint256) external returns (bool) {}
}
