# IAddressRegistry









## Methods

### addLenderVault

```solidity
function addLenderVault(address addr) external nonpayable
```

adds new lender vault to registry

*can only be called lender vault factory*

#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | address of new lender vault |

### borrowerGateway

```solidity
function borrowerGateway() external view returns (address)
```

Returns the address of the borrower gateway




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | Address of the borrower gateway contract |

### initialize

```solidity
function initialize(address _lenderVaultFactory, address _borrowerGateway, address _quoteHandler) external nonpayable
```

initializes factory, gateway, and quote handler contracts



#### Parameters

| Name | Type | Description |
|---|---|---|
| _lenderVaultFactory | address | address of the factory for lender vaults |
| _borrowerGateway | address | address of the gateway with which borrowers interact |
| _quoteHandler | address | address of contract which handles quote logic |

### isRegisteredVault

```solidity
function isRegisteredVault(address addr) external view returns (bool)
```

Returns boolean flag indicating whether given address is a registered vault



#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | Address to check if it is a registered vault |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Boolean flag indicating whether given address is a registered vault |

### isWhitelistedCallbackAddr

```solidity
function isWhitelistedCallbackAddr(address addr) external view returns (bool)
```

Returns boolean flag indicating whether given address is a whitelisted callback contract



#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | Address to check if it is a whitelisted callback contract |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Boolean flag indicating whether given address is a whitelisted callback contract |

### isWhitelistedCompartmentImpl

```solidity
function isWhitelistedCompartmentImpl(address addr) external view returns (bool)
```

Returns boolean flag indicating whether given address is a whitelisted compartment implementation contract



#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | Address to check if it is a whitelisted compartment implementation contract |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Boolean flag indicating whether given address is a whitelisted compartment implementation contract |

### isWhitelistedOracle

```solidity
function isWhitelistedOracle(address addr) external view returns (bool)
```

Returns boolean flag indicating whether given address is a whitelisted oracle contract



#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | Address to check if it is a whitelisted oracle contract |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Boolean flag indicating whether given address is a whitelisted oracle contract |

### isWhitelistedToken

```solidity
function isWhitelistedToken(address addr) external view returns (bool)
```

Returns boolean flag indicating whether given address is a whitelisted token



#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | Address to check if it is a whitelisted token |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Boolean flag indicating whether given address is a whitelisted token |

### lenderVaultFactory

```solidity
function lenderVaultFactory() external view returns (address)
```

Returns the address of the vault factory




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | Address of the vault factory contract |

### owner

```solidity
function owner() external view returns (address)
```

Returns address of the owner




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | Address of the owner |

### quoteHandler

```solidity
function quoteHandler() external view returns (address)
```

Returns the address of the quote handler




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | Address of the quote handler contract |

### registeredVaults

```solidity
function registeredVaults() external view returns (address[] vaultAddrs)
```

Returns an array of registered vault addresses




#### Returns

| Name | Type | Description |
|---|---|---|
| vaultAddrs | address[] | The array of registered vault addresses |

### toggleCallbackAddr

```solidity
function toggleCallbackAddr(address addr, bool whitelistStatus) external nonpayable
```

toggles whitelist status of callback

*can only be called by registry owner*

#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | address of callback |
| whitelistStatus | bool | true if whitelisted, else false to delist |

### toggleCompartmentImpl

```solidity
function toggleCompartmentImpl(address addr, bool whitelistStatus) external nonpayable
```

toggles whitelist status of compartment

*can only be called by registry owner*

#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | address of compartment |
| whitelistStatus | bool | true if whitelisted, else false to delist |

### toggleOracle

```solidity
function toggleOracle(address addr, bool whitelistStatus) external nonpayable
```

toggles whitelist status of oracle

*can only be called by registry owner*

#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | address of oracle |
| whitelistStatus | bool | true if whitelisted, else false to delist |

### toggleTokens

```solidity
function toggleTokens(address[] addrs, bool whitelistStatus) external nonpayable
```

toggles whitelist status of provided tokens

*can only be called by registry owner*

#### Parameters

| Name | Type | Description |
|---|---|---|
| addrs | address[] | addresses of tokens |
| whitelistStatus | bool | true if whitelisted, else false to delist |




