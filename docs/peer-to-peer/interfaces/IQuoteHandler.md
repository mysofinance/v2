# IQuoteHandler









## Methods

### addOnChainQuote

```solidity
function addOnChainQuote(address lenderVault, DataTypes.OnChainQuote onChainQuote) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | undefined |
| onChainQuote | DataTypes.OnChainQuote | undefined |

### addressRegistry

```solidity
function addressRegistry() external view returns (address)
```

function to return address of registry




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | registry address |

### checkAndRegisterOffChainQuote

```solidity
function checkAndRegisterOffChainQuote(address borrower, address lenderVault, DataTypes.OffChainQuote offChainQuote, DataTypes.QuoteTuple quoteTuple, bytes32[] proof) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| borrower | address | undefined |
| lenderVault | address | undefined |
| offChainQuote | DataTypes.OffChainQuote | undefined |
| quoteTuple | DataTypes.QuoteTuple | undefined |
| proof | bytes32[] | undefined |

### checkAndRegisterOnChainQuote

```solidity
function checkAndRegisterOnChainQuote(address borrower, address lenderVault, DataTypes.OnChainQuote onChainQuote) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| borrower | address | undefined |
| lenderVault | address | undefined |
| onChainQuote | DataTypes.OnChainQuote | undefined |

### deleteOnChainQuote

```solidity
function deleteOnChainQuote(address lenderVault, DataTypes.OnChainQuote onChainQuote) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | undefined |
| onChainQuote | DataTypes.OnChainQuote | undefined |

### incrementOffChainQuoteNonce

```solidity
function incrementOffChainQuoteNonce(address lenderVault) external nonpayable
```

function increments the nonce for a vault

*function can only be called by vault owner incrementing the nonce can bulk invalidate any off chain quotes with that nonce in one txn*

#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | address of the vault |

### invalidateOffChainQuote

```solidity
function invalidateOffChainQuote(address lenderVault, bytes32 offChainQuoteHash) external nonpayable
```

function invalidates off chain quote

*function can only be called by vault owner this function invalidates one specific quote*

#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | address of the vault |
| offChainQuoteHash | bytes32 | hash of the off chain quote to be invalidated |

### isOnChainQuote

```solidity
function isOnChainQuote(address lenderVault, bytes32 hashToCheck) external view returns (bool)
```

function returns if hash is for an on chain quote



#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | address of vault |
| hashToCheck | bytes32 | hash of the on chain quote |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | true if hash belongs to a valid on-chain quote, else false |

### offChainQuoteIsInvalidated

```solidity
function offChainQuoteIsInvalidated(address lenderVault, bytes32 hashToCheck) external view returns (bool)
```

function returns if offchain quote hash is invalidated



#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | address of vault |
| hashToCheck | bytes32 | hash of the offchain quote |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | true if invalidated, else false |

### offChainQuoteNonce

```solidity
function offChainQuoteNonce(address lender) external view returns (uint256)
```

function to return the current nonce for offchain quotes



#### Parameters

| Name | Type | Description |
|---|---|---|
| lender | address | address for which nonce is being retrieved |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | current value of nonce |

### updateOnChainQuote

```solidity
function updateOnChainQuote(address lenderVault, DataTypes.OnChainQuote oldOnChainQuote, DataTypes.OnChainQuote newOnChainQuote) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | undefined |
| oldOnChainQuote | DataTypes.OnChainQuote | undefined |
| newOnChainQuote | DataTypes.OnChainQuote | undefined |




