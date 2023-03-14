# Details

Date : 2023-03-14 14:44:18

Directory c:\\Users\\Aetienne\\Desktop\\MYSO\\15 repos\\v1.2\\contracts

Total : 37 files,  3075 codes, 196 comments, 395 blanks, all 3666 lines

[Summary](results.md) / Details / [Diff Summary](diff.md) / [Diff Details](diff-details.md)

## Files
| filename | language | code | comment | blank | total |
| :--- | :--- | ---: | ---: | ---: | ---: |
| [contracts/Constants.sol](/contracts/Constants.sol) | Solidity | 6 | 1 | 2 | 9 |
| [contracts/peer-to-peer/AddressRegistry.sol](/contracts/peer-to-peer/AddressRegistry.sol) | Solidity | 99 | 1 | 12 | 112 |
| [contracts/peer-to-peer/BorrowerGateway.sol](/contracts/peer-to-peer/BorrowerGateway.sol) | Solidity | 327 | 11 | 36 | 374 |
| [contracts/peer-to-peer/DataTypes.sol](/contracts/peer-to-peer/DataTypes.sol) | Solidity | 64 | 1 | 8 | 73 |
| [contracts/peer-to-peer/LenderVault.sol](/contracts/peer-to-peer/LenderVault.sol) | Solidity | 357 | 7 | 35 | 399 |
| [contracts/peer-to-peer/LenderVaultFactory.sol](/contracts/peer-to-peer/LenderVaultFactory.sol) | Solidity | 27 | 1 | 6 | 34 |
| [contracts/peer-to-peer/QuoteHandler.sol](/contracts/peer-to-peer/QuoteHandler.sol) | Solidity | 345 | 2 | 20 | 367 |
| [contracts/peer-to-peer/callbacks/BalancerV2Looping.sol](/contracts/peer-to-peer/callbacks/BalancerV2Looping.sol) | Solidity | 113 | 5 | 13 | 131 |
| [contracts/peer-to-peer/callbacks/UniV3Looping.sol](/contracts/peer-to-peer/callbacks/UniV3Looping.sol) | Solidity | 110 | 2 | 16 | 128 |
| [contracts/peer-to-peer/compartments/BaseCompartment.sol](/contracts/peer-to-peer/compartments/BaseCompartment.sol) | Solidity | 9 | 1 | 5 | 15 |
| [contracts/peer-to-peer/compartments/staking/AaveStakingCompartment.sol](/contracts/peer-to-peer/compartments/staking/AaveStakingCompartment.sol) | Solidity | 41 | 7 | 7 | 55 |
| [contracts/peer-to-peer/compartments/staking/CurveLPStakingCompartment.sol](/contracts/peer-to-peer/compartments/staking/CurveLPStakingCompartment.sol) | Solidity | 143 | 21 | 32 | 196 |
| [contracts/peer-to-peer/compartments/staking/GLPStakingCompartment.sol](/contracts/peer-to-peer/compartments/staking/GLPStakingCompartment.sol) | Solidity | 52 | 12 | 15 | 79 |
| [contracts/peer-to-peer/compartments/voting/VoteCompartment.sol](/contracts/peer-to-peer/compartments/voting/VoteCompartment.sol) | Solidity | 54 | 3 | 8 | 65 |
| [contracts/peer-to-peer/interfaces/IAddressRegistry.sol](/contracts/peer-to-peer/interfaces/IAddressRegistry.sol) | Solidity | 28 | 1 | 16 | 45 |
| [contracts/peer-to-peer/interfaces/IBorrowerCompartment.sol](/contracts/peer-to-peer/interfaces/IBorrowerCompartment.sol) | Solidity | 14 | 24 | 6 | 44 |
| [contracts/peer-to-peer/interfaces/IBorrowerGateway.sol](/contracts/peer-to-peer/interfaces/IBorrowerGateway.sol) | Solidity | 23 | 1 | 4 | 28 |
| [contracts/peer-to-peer/interfaces/ILenderVault.sol](/contracts/peer-to-peer/interfaces/ILenderVault.sol) | Solidity | 49 | 1 | 13 | 63 |
| [contracts/peer-to-peer/interfaces/ILenderVaultFactory.sol](/contracts/peer-to-peer/interfaces/ILenderVaultFactory.sol) | Solidity | 5 | 1 | 4 | 10 |
| [contracts/peer-to-peer/interfaces/IOracle.sol](/contracts/peer-to-peer/interfaces/IOracle.sol) | Solidity | 7 | 1 | 3 | 11 |
| [contracts/peer-to-peer/interfaces/IQuoteHandler.sol](/contracts/peer-to-peer/interfaces/IQuoteHandler.sol) | Solidity | 16 | 1 | 5 | 22 |
| [contracts/peer-to-peer/interfaces/IVaultCallback.sol](/contracts/peer-to-peer/interfaces/IVaultCallback.sol) | Solidity | 12 | 1 | 4 | 17 |
| [contracts/peer-to-peer/interfaces/compartments/staking/IStakingHelper.sol](/contracts/peer-to-peer/interfaces/compartments/staking/IStakingHelper.sol) | Solidity | 15 | 35 | 14 | 64 |
| [contracts/peer-to-peer/interfaces/oracles/IOlympus.sol](/contracts/peer-to-peer/interfaces/oracles/IOlympus.sol) | Solidity | 4 | 1 | 2 | 7 |
| [contracts/peer-to-peer/interfaces/oracles/IUniV2.sol](/contracts/peer-to-peer/interfaces/oracles/IUniV2.sol) | Solidity | 7 | 1 | 5 | 13 |
| [contracts/peer-to-peer/interfaces/oracles/chainlink/AggregatorV3Interface.sol](/contracts/peer-to-peer/interfaces/oracles/chainlink/AggregatorV3Interface.sol) | Solidity | 28 | 1 | 6 | 35 |
| [contracts/peer-to-peer/oracles/chainlink/ChainlinkBasic.sol](/contracts/peer-to-peer/oracles/chainlink/ChainlinkBasic.sol) | Solidity | 134 | 12 | 9 | 155 |
| [contracts/peer-to-peer/oracles/chainlink/OlympusOracle.sol](/contracts/peer-to-peer/oracles/chainlink/OlympusOracle.sol) | Solidity | 134 | 7 | 11 | 152 |
| [contracts/peer-to-peer/oracles/chainlink/UniV2Chainlink.sol](/contracts/peer-to-peer/oracles/chainlink/UniV2Chainlink.sol) | Solidity | 243 | 13 | 15 | 271 |
| [contracts/peer-to-pool/DataTypes.sol](/contracts/peer-to-pool/DataTypes.sol) | Solidity | 26 | 1 | 4 | 31 |
| [contracts/peer-to-pool/FundingPool.sol](/contracts/peer-to-pool/FundingPool.sol) | Solidity | 118 | 1 | 10 | 129 |
| [contracts/peer-to-pool/LoanProposalFactory.sol](/contracts/peer-to-pool/LoanProposalFactory.sol) | Solidity | 34 | 1 | 6 | 41 |
| [contracts/peer-to-pool/LoanProposalImpl.sol](/contracts/peer-to-pool/LoanProposalImpl.sol) | Solidity | 391 | 14 | 22 | 427 |
| [contracts/test/IPAXG.sol](/contracts/test/IPAXG.sol) | Solidity | 6 | 0 | 4 | 10 |
| [contracts/test/IUSDC.sol](/contracts/test/IUSDC.sol) | Solidity | 10 | 1 | 6 | 17 |
| [contracts/test/IWETH.sol](/contracts/test/IWETH.sol) | Solidity | 5 | 1 | 4 | 10 |
| [contracts/test/MyERC20.sol](/contracts/test/MyERC20.sol) | Solidity | 19 | 1 | 7 | 27 |

[Summary](results.md) / Details / [Diff Summary](diff.md) / [Diff Details](diff-details.md)