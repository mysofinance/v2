// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../../peer-to-peer/DataTypesPeerToPeer.sol";

interface ITokenBasketWrapper {
    /**
     * @notice creates a wrapped token basket
     * @param minter address of the minter
     * @param tokenInfo token addresses and amounts to be wrapped, as well as the name and symbol of the wrapped token basket
     * @return newErc20Addr address of the new wrapped token basket that was created
     */
    function createWrappedTokenBasket(
        address minter,
        DataTypesPeerToPeer.TokenBasketWrapperInfo calldata tokenInfo
    ) external returns (address);
}
