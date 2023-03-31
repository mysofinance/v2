# IEvents










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
event LoanProposalCreated(address indexed loanProposalAddr, address indexed fundingPool, address indexed sender, address collToken, uint256 arrangerFee, uint256 unsubscribeGracePeriod)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanProposalAddr `indexed` | address | undefined |
| fundingPool `indexed` | address | undefined |
| sender `indexed` | address | undefined |
| collToken  | address | undefined |
| arrangerFee  | uint256 | undefined |
| unsubscribeGracePeriod  | uint256 | undefined |

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



