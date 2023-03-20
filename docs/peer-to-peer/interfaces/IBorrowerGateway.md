# IBorrowerGateway









## Methods

### addressRegistry

```solidity
function addressRegistry() external view returns (address)
```

function returns address registry




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | address of registry |

### borrowWithOffChainQuote

```solidity
function borrowWithOffChainQuote(address lenderVault, DataTypes.BorrowTransferInstructions borrowInstructions, DataTypes.OffChainQuote offChainQuote, DataTypes.QuoteTuple quoteTuple, bytes32[] proof) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | undefined |
| borrowInstructions | DataTypes.BorrowTransferInstructions | undefined |
| offChainQuote | DataTypes.OffChainQuote | undefined |
| quoteTuple | DataTypes.QuoteTuple | undefined |
| proof | bytes32[] | undefined |

### borrowWithOnChainQuote

```solidity
function borrowWithOnChainQuote(address lenderVault, DataTypes.BorrowTransferInstructions borrowInstructions, DataTypes.OnChainQuote onChainQuote, uint256 quoteTupleIdx) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | undefined |
| borrowInstructions | DataTypes.BorrowTransferInstructions | undefined |
| onChainQuote | DataTypes.OnChainQuote | undefined |
| quoteTupleIdx | uint256 | undefined |

### protocolFee

```solidity
function protocolFee() external view returns (uint256)
```

function returns protocol fee




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | protocol fee in BASE |

### repay

```solidity
function repay(DataTypes.LoanRepayInstructions loanRepayInstructions, address vaultAddr, address callbackAddr, bytes callbackData) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanRepayInstructions | DataTypes.LoanRepayInstructions | undefined |
| vaultAddr | address | undefined |
| callbackAddr | address | undefined |
| callbackData | bytes | undefined |

### setNewProtocolFee

```solidity
function setNewProtocolFee(uint256 _newFee) external nonpayable
```

function which allows owner to set new protocol fee

*protocolFee is in units of BASE constant (10**18) and annualized*

#### Parameters

| Name | Type | Description |
|---|---|---|
| _newFee | uint256 | new fee in BASE |




