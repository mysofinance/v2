# IOracle









## Methods

### getPrice

```solidity
function getPrice(address collToken, address loanToken) external view returns (uint256 collTokenPriceInLoanToken)
```

function checks oracle validity and calculates collTokenPriceInLoanToken



#### Parameters

| Name | Type | Description |
|---|---|---|
| collToken | address | address of coll token |
| loanToken | address | address of loan token |

#### Returns

| Name | Type | Description |
|---|---|---|
| collTokenPriceInLoanToken | uint256 | collateral price denominated in loan token |




