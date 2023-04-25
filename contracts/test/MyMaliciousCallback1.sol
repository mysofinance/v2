// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.19;

contract MyMaliciousCallback1 {
    uint256 internal vaultVictim;
    address internal collToken;
    address internal compartmentVictim;

    constructor(
        address _vaultVictim,
        address _collToken,
        address _compartmentVictim
    ) {
        /* need to shift _vaultVictim by 4x hex to match storage layout f BaseCompartment such that
         * retrieving vaultAddr in BaseCompartment maps to vaultVictim in this contract and access
         * control check in BaseCompartment (i.e., msg.sender != vaultAddr) could be bypassed
         */
        vaultVictim = uint256(uint160(_vaultVictim)) * 16 * 16 * 16 * 16;
        collToken = _collToken;
        compartmentVictim = _compartmentVictim;
    }

    function balanceOf(address) external returns (uint256) {
        /* Try hijacking control flow by tricking vault owner to call withdraw function with this purported
         * token contract and then use delegate call transferCollFromCompartment(...) and pretend msg.sender to
         * be the vault.
         */
        (bool success, bytes memory result) = compartmentVictim.delegatecall(
            abi.encodeWithSignature(
                "transferCollFromCompartment(uint256,uint256,address,address,address)",
                1,
                1,
                address(this),
                collToken,
                address(0)
            )
        );
        /* The delegate call is expected to fail because of mutex in _withdrawCheck()
         * Note: even if there wasn't a _withdrawCheck() then delegate call and access check could be
         * bypassed, then delegate call would operate on the contract state and balance of MyMaliciousCallback1,
         * NOT on balance of compartment, hence the compartment balance wouldn't be at risk
         */
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function transfer(address, uint256) external returns (bool) {}
}
