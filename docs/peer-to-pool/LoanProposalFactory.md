# LoanProposalFactory









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

### claimOwnership

```solidity
function claimOwnership() external nonpayable
```






### createLoanProposal

```solidity
function createLoanProposal(address _fundingPool, address _collToken, uint256 _arrangerFee, uint256 _lenderGracePeriod, uint256 _conversionGracePeriod, uint256 _repaymentGracePeriod) external nonpayable
```

Creates a new loan proposal



#### Parameters

| Name | Type | Description |
|---|---|---|
| _fundingPool | address | The address of the funding pool from which lenders are allowed to subscribe, and -if loan proposal is successful- from where loan amount is sourced |
| _collToken | address | The address of collateral token to be provided by borrower |
| _arrangerFee | uint256 | The relative arranger fee (where 100% = BASE) |
| _lenderGracePeriod | uint256 | If a lender subscribes to a loan and it gets accepted by the borrower, then the lender can still unsubscribe for _lenderGracePeriod before otherwise being locked in and funding the given loan proposal |
| _conversionGracePeriod | uint256 | The grace period during which lenders can convert |
| _repaymentGracePeriod | uint256 | The grace period during which borrowers can repay |

### isLoanProposal

```solidity
function isLoanProposal(address) external view returns (bool)
```

Returns flag whether given address is a registered loan proposal contract



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

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
function loanProposals(uint256) external view returns (address)
```

Returns the address of a registered loan proposal



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | The address of a registered loan proposal |

### owner

```solidity
function owner() external view returns (address)
```






#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

### proposeNewOwner

```solidity
function proposeNewOwner(address _newOwnerProposal) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| _newOwnerProposal | address | undefined |

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



## Events

### ClaimRepayment

```solidity
event ClaimRepayment(address indexed sender, uint256 amount)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| sender `indexed` | address | undefined |
| amount  | uint256 | undefined |

### ClaimedOwnership

```solidity
event ClaimedOwnership(address indexed owner, address oldOwner)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| owner `indexed` | address | undefined |
| oldOwner  | address | undefined |

### ConversionExercised

```solidity
event ConversionExercised(address indexed sender, uint256 repaymentIdx, uint256 amount)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| sender `indexed` | address | undefined |
| repaymentIdx  | uint256 | undefined |
| amount  | uint256 | undefined |

### DefaultProceedsClaimed

```solidity
event DefaultProceedsClaimed(address indexed sender)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| sender `indexed` | address | undefined |

### LoanDefaulted

```solidity
event LoanDefaulted()
```






### LoanDeployed

```solidity
event LoanDeployed()
```






### LoanProposalCreated

```solidity
event LoanProposalCreated(address indexed loanProposalAddr, address indexed fundingPool, address indexed sender, address collToken, uint256 arrangerFee, uint256 lenderGracePeriod)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposalAddr `indexed` | address | undefined |
| fundingPool `indexed` | address | undefined |
| sender `indexed` | address | undefined |
| collToken  | address | undefined |
| arrangerFee  | uint256 | undefined |
| lenderGracePeriod  | uint256 | undefined |

### LoanProposalExecuted

```solidity
event LoanProposalExecuted(address indexed loanProposalAddr)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposalAddr `indexed` | address | undefined |

### LoanTermsAccepted

```solidity
event LoanTermsAccepted()
```






### LoanTermsAndTransferCollFinalized

```solidity
event LoanTermsAndTransferCollFinalized(uint256 finalLoanAmount, uint256 _finalCollAmountReservedForDefault, uint256 _finalCollAmountReservedForConversions, uint256 _arrangerFee)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| finalLoanAmount  | uint256 | undefined |
| _finalCollAmountReservedForDefault  | uint256 | undefined |
| _finalCollAmountReservedForConversions  | uint256 | undefined |
| _arrangerFee  | uint256 | undefined |

### LoanTermsProposed

```solidity
event LoanTermsProposed(DataTypes.LoanTerms loanTerms)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanTerms  | DataTypes.LoanTerms | undefined |

### NewOwnerProposed

```solidity
event NewOwnerProposed(address indexed owner, address newOwner)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| owner `indexed` | address | undefined |
| newOwner  | address | undefined |

### Repay

```solidity
event Repay(uint256 remainingLoanTokenDue, uint256 collTokenLeftUnconverted)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| remainingLoanTokenDue  | uint256 | undefined |
| collTokenLeftUnconverted  | uint256 | undefined |

### Rollback

```solidity
event Rollback()
```






### Subscribed

```solidity
event Subscribed(address indexed loanProposalAddr, uint256 amount)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposalAddr `indexed` | address | undefined |
| amount  | uint256 | undefined |

### Unsubscribed

```solidity
event Unsubscribed(address indexed loanProposalAddr, uint256 amount)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposalAddr `indexed` | address | undefined |
| amount  | uint256 | undefined |



## Errors

### InvalidFee

```solidity
error InvalidFee()
```






### InvalidSender

```solidity
error InvalidSender()
```







