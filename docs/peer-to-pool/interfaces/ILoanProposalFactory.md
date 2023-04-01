# ILoanProposalFactory









## Methods

### arrangerFeeSplit

```solidity
function arrangerFeeSplit() external view returns (uint256)
```

Returns the arranger fee split between the arranger and the protocol (e.g. 10% = BASE/10, meaning 10% of absolute arranger fee goes to protocol and rest to arranger)




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | The arranger fee split between the arranger and the protocol |

### createLoanProposal

```solidity
function createLoanProposal(address _fundingPool, address _collToken, uint256 _arrangerFee, uint256 _unsubscribeGracePeriod, uint256 _conversionGracePeriod, uint256 _repaymentGracePeriod) external nonpayable
```

Creates a new loan proposal



#### Parameters

| Name | Type | Description |
|---|---|---|
| _fundingPool | address | The address of the funding pool from which lenders are allowed to subscribe, and -if loan proposal is successful- from where loan amount is sourced |
| _collToken | address | The address of collateral token to be provided by borrower |
| _arrangerFee | uint256 | The relative arranger fee (where 100% = BASE) |
| _unsubscribeGracePeriod | uint256 | The unsubscribe grace period, i.e., after a loan gets accepted by the borrower lenders can still unsubscribe for this time period before being locked-in |
| _conversionGracePeriod | uint256 | The grace period during which lenders can convert |
| _repaymentGracePeriod | uint256 | The grace period during which borrowers can repay |

### isLoanProposal

```solidity
function isLoanProposal(address addr) external view returns (bool)
```

Returns flag whether given address is a registered loan proposal contract



#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | The address to check if its a registered loan proposal |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Flag indicating whether address is a registered loan proposal contract |

### loanProposalImpl

```solidity
function loanProposalImpl() external view returns (address)
```

Returns the address of the proposal implementation




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | The address of the proposal implementation |

### loanProposals

```solidity
function loanProposals(uint256 idx) external view returns (address)
```

Returns the address of a registered loan proposal



#### Parameters

| Name | Type | Description |
|---|---|---|
| idx | uint256 | The index of the given loan proposal |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | The address of a registered loan proposal |

### owner

```solidity
function owner() external view returns (address)
```

Returns the address of the owner of this contract




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | The address of the owner of this contract |

### setArrangerFeeSplit

```solidity
function setArrangerFeeSplit(uint256 _newArrangerFeeSplit) external nonpayable
```

Sets the arranger fee split between the arranger and the protocol

*Can only be called by the loan proposal factory owner*

#### Parameters

| Name | Type | Description |
|---|---|---|
| _newArrangerFeeSplit | uint256 | The given arranger fee split (e.g. 10% = BASE/10, meaning 10% of absolute arranger fee goes to protocol and rest to arranger); note that this amount must be smaller than Constants.MAX_ARRANGER_SPLIT (&lt;50%) |




