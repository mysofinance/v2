# MYSO
This repository contains the smart contracts source code for the MYSO v2 protocol. The repository uses Hardhat as development environment for compilation, testing and deployment tasks.

## What is MYSO?
The MYSO v2 protocol allows borrowing and lending based on so called Zero-Liquidation Loans. A Zero-Liquidation Loan is a crypto-collateralized loan in which the borrower pledges some collateral token and borrows some loan token against it. However, in contrast to conventional DeFi loans, borrowers aren't exposed to liquidation risk, meaning that their collateral is never at risk of being forcefully auctioned off to liquidators in case the collateral price drops below a liquidation threshold (even if the price rebounds afterwards again). Zero-Liquidation Loans have a fixed tenor (e.g., 90 days) during which borrowers have the right (but not the obligation) to reclaim their collateral by repaying a pre-defined repayment amount. If borrowers don't repay prior to expiry they forfeit their ability to reclaim their collateral, in which case the collateral gets redistributed to lenders. Lenders of Zero-Liquidation Loans -by design- bear default risk, however, can earn yield for this (the payoff is similar to a covered call strategy).

### Use Cases
The protocol supports two different models, each targeted at different use cases and user groups:
* Peer-to-peer model: in this model, the target borrowers are smaller to medium sized borrowers who are looking for (I) loan offers for niche collateral assets that currently aren’t supported on Aave etc. and/or (ii) loan alternatives for bluechips (e.g. ETH etc.) but without liquidation risk. Target lenders are medium sized lenders (e.g., like the MYSO team, or lending clubs/collectives) as well as larger sized lenders (e.g., whales or institutional lenders) who are looking for higher yields than on Aave and are interested in capitalizing on underserved borrowing demand with less (or no) competition and correspondingly higher extractable risk premiums.
* Peer-to-pool model: in this model, the target borrowers are DAO treasuries, and the target lenders are the MYSO community, and/or other DeFi communities. DAO treasuries can borrow stables against their native token (which makes up most of DAO treasuries), using ZLLs to diversify from their native token holdings and utilize the borrowed stables to (i) earn yield, (ii) cover short/mid term liquidity needs/expenses, (iii) bootstrap liquidity in own DeFi offerings –if applicable. In the peer-to-pool mode, ZLLs also come with a convertible feature which allows the DAO treasury to lower interest rate costs by giving up upside to borrowers and, for borrowers provides upside participation. In this model, borrowers and lenders are brought together through “arrangers”, who can propose and pitch loan structures to DAO treasuries, and to which lenders –who previously deposited funds into a pool– can subscribe to.

## Quick Start
```
npm i
npx hardhat test
```

## Contract Files
```
contracts/
┣ interfaces/
┃ ┗ IMysoTokenManager.sol
┣ peer-to-peer/
┃ ┣ callbacks/
┃ ┃ ┣ BalancerV2Looping.sol
┃ ┃ ┣ UniV3Looping.sol
┃ ┃ ┗ VaultCallback.sol
┃ ┣ compartments/
┃ ┃ ┣ staking/
┃ ┃ ┃ ┣ AaveStakingCompartment.sol
┃ ┃ ┃ ┣ CurveLPStakingCompartment.sol
┃ ┃ ┃ ┗ GLPStakingCompartment.sol
┃ ┃ ┣ voting/
┃ ┃ ┃ ┗ VoteCompartment.sol
┃ ┃ ┗ BaseCompartment.sol
┃ ┣ interfaces/
┃ ┃ ┣ callbacks/
┃ ┃ ┃ ┣ BalancerDataTypes.sol
┃ ┃ ┃ ┣ IBalancerAsset.sol
┃ ┃ ┃ ┣ IBalancerVault.sol
┃ ┃ ┃ ┗ ISwapRouter.sol
┃ ┃ ┣ compartments/
┃ ┃ ┃ ┣ staking/
┃ ┃ ┃ ┃ ┣ ICurveStakingHelper.sol
┃ ┃ ┃ ┃ ┗ IGLPStakingHelper.sol
┃ ┃ ┃ ┗ IBaseCompartment.sol
┃ ┃ ┣ oracles/
┃ ┃ ┃ ┣ chainlink/
┃ ┃ ┃ ┃ ┗ AggregatorV3Interface.sol
┃ ┃ ┃ ┣ uniswap/
┃ ┃ ┃ ┃ ┗ ITwapGetter.sol
┃ ┃ ┃ ┣ IDSETH.sol
┃ ┃ ┃ ┣ IOlympus.sol
┃ ┃ ┃ ┗ IUniV2.sol
┃ ┃ ┣ wrappers/
┃ ┃ ┃ ┣ ERC20/
┃ ┃ ┃ ┃ ┣ IERC20Wrapper.sol
┃ ┃ ┃ ┃ ┗ IWrappedERC20Impl.sol
┃ ┃ ┃ ┗ ERC721/
┃ ┃ ┃   ┣ IERC721Wrapper.sol
┃ ┃ ┃   ┗ IWrappedERC721Impl.sol
┃ ┃ ┣ IAddressRegistry.sol
┃ ┃ ┣ IBorrowerGateway.sol
┃ ┃ ┣ ILenderVaultFactory.sol
┃ ┃ ┣ ILenderVaultImpl.sol
┃ ┃ ┣ IOracle.sol
┃ ┃ ┣ IQuoteHandler.sol
┃ ┃ ┗ IVaultCallback.sol
┃ ┣ oracles/
┃ ┃ ┣ chainlink/
┃ ┃ ┃ ┣ ChainlinkArbitrumSequencerUSD.sol
┃ ┃ ┃ ┣ ChainlinkBase.sol
┃ ┃ ┃ ┣ ChainlinkBasic.sol
┃ ┃ ┃ ┣ ChainlinkBasicWithWbtc.sol
┃ ┃ ┃ ┣ OlympusOracle.sol
┃ ┃ ┃ ┗ UniV2Chainlink.sol
┃ ┃ ┗ uniswap/
┃ ┃   ┣ FullMath.sol
┃ ┃   ┣ IndexCoopOracle.sol
┃ ┃   ┣ TickMath.sol
┃ ┃   ┗ TwapGetter.sol
┃ ┣ wrappers/
┃ ┃ ┣ ERC20/
┃ ┃ ┃ ┣ ERC20Wrapper.sol
┃ ┃ ┃ ┗ WrappedERC20Impl.sol
┃ ┃ ┗ ERC721/
┃ ┃   ┣ ERC721Wrapper.sol
┃ ┃   ┗ WrappedERC721Impl.sol
┃ ┣ AddressRegistry.sol
┃ ┣ BorrowerGateway.sol
┃ ┣ DataTypesPeerToPeer.sol
┃ ┣ LenderVaultFactory.sol
┃ ┣ LenderVaultImpl.sol
┃ ┗ QuoteHandler.sol
┣ peer-to-pool/
┃ ┣ interfaces/
┃ ┃ ┣ IFactory.sol
┃ ┃ ┣ IFundingPoolImpl.sol
┃ ┃ ┗ ILoanProposalImpl.sol
┃ ┣ DataTypesPeerToPool.sol
┃ ┣ Factory.sol
┃ ┣ FundingPoolImpl.sol
┃ ┗ LoanProposalImpl.sol
┣ test/
┃ ┣ IPAXG.sol
┃ ┣ IUSDC.sol
┃ ┣ IWETH.sol
┃ ┣ MaliciousCompartment.sol
┃ ┣ MaliciousOwnerContract.sol
┃ ┣ MyERC20.sol
┃ ┣ MyERC721.sol
┃ ┣ MyMaliciousCallback1.sol
┃ ┣ MyMaliciousCallback2.sol
┃ ┣ MyMaliciousERC20.sol
┃ ┗ TestnetTokenManager.sol
┣ Constants.sol
┣ Errors.sol
┗ Helpers.sol
```

## Libraries & Dependencies

The following OpenZeppelin 4.8.0 libraries are used:
* IERC20Metadata
* SafeERC20
* Initializable
* Clones
* Math

The following DeFi integrations are incorporated:
* Callbacks/Looping -> Uni v3 and Balancer
* Compartments/Collateral Management -> Curve, GLP, Aave aTokens
* Oracle -> Chainlink, Olympus Ohm

## Test Files
```
test/
┣ peer-to-peer/
┃ ┣ helpers/
┃ ┃ ┣ abi.ts
┃ ┃ ┣ misc.ts
┃ ┃ ┗ uniV3.ts
┃ ┣ arbitrum-forked-tests.ts
┃ ┣ local-tests.ts
┃ ┣ mainnet-forked-tests.ts
┃ ┗ mainnet-recent-forked-tests.ts
┗ peer-to-pool/
  ┣ helpers/
┃ ┃ ┗ misc.ts
  ┗ local-tests.ts
```

### Test Coverage
```
---------------------------------------------------------|----------|----------|----------|----------|----------------|
File                                                     |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
---------------------------------------------------------|----------|----------|----------|----------|----------------|
 contracts\                                              |      100 |       50 |      100 |      100 |                |
  Constants.sol                                          |      100 |      100 |      100 |      100 |                |
  Errors.sol                                             |      100 |      100 |      100 |      100 |                |
  Helpers.sol                                            |      100 |       50 |      100 |      100 |                |
 contracts\interfaces\                                   |      100 |      100 |      100 |      100 |                |
  IMysoTokenManager.sol                                  |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\                                 |    99.45 |    91.41 |     97.3 |    97.67 |                |
  AddressRegistry.sol                                    |      100 |    90.22 |      100 |     97.5 |     81,117,162 |
  BorrowerGateway.sol                                    |    98.55 |    91.18 |    90.91 |       97 |    248,323,364 |
  DataTypesPeerToPeer.sol                                |      100 |      100 |      100 |      100 |                |
  LenderVaultFactory.sol                                 |      100 |     87.5 |      100 |      100 |                |
  LenderVaultImpl.sol                                    |    98.98 |     88.6 |       96 |    96.61 |... 342,343,432 |
  QuoteHandler.sol                                       |      100 |    96.08 |      100 |    99.34 |            371 |
 contracts\peer-to-peer\callbacks\                       |      100 |       75 |    88.89 |    96.88 |                |
  BalancerV2Looping.sol                                  |      100 |      100 |      100 |      100 |                |
  UniV3Looping.sol                                       |      100 |      100 |      100 |      100 |                |
  VaultCallback.sol                                      |      100 |       75 |    66.67 |    83.33 |             14 |
 contracts\peer-to-peer\compartments\                    |      100 |    91.67 |      100 |    93.75 |                |
  BaseCompartment.sol                                    |      100 |    91.67 |      100 |    93.75 |             27 |
 contracts\peer-to-peer\compartments\staking\            |    94.67 |       78 |      100 |    90.91 |                |
  AaveStakingCompartment.sol                             |      100 |      100 |      100 |      100 |                |
  CurveLPStakingCompartment.sol                          |    93.44 |    76.09 |      100 |    89.41 |... 315,317,318 |
  GLPStakingCompartment.sol                              |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\compartments\voting\             |      100 |       90 |      100 |    95.24 |                |
  VoteCompartment.sol                                    |      100 |       90 |      100 |    95.24 |             40 |
 contracts\peer-to-peer\interfaces\                      |      100 |      100 |      100 |      100 |                |
  IAddressRegistry.sol                                   |      100 |      100 |      100 |      100 |                |
  IBorrowerGateway.sol                                   |      100 |      100 |      100 |      100 |                |
  ILenderVaultFactory.sol                                |      100 |      100 |      100 |      100 |                |
  ILenderVaultImpl.sol                                   |      100 |      100 |      100 |      100 |                |
  IOracle.sol                                            |      100 |      100 |      100 |      100 |                |
  IQuoteHandler.sol                                      |      100 |      100 |      100 |      100 |                |
  IVaultCallback.sol                                     |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\callbacks\            |      100 |      100 |      100 |      100 |                |
  BalancerDataTypes.sol                                  |      100 |      100 |      100 |      100 |                |
  IBalancerAsset.sol                                     |      100 |      100 |      100 |      100 |                |
  IBalancerVault.sol                                     |      100 |      100 |      100 |      100 |                |
  ISwapRouter.sol                                        |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\compartments\         |      100 |      100 |      100 |      100 |                |
  IBaseCompartment.sol                                   |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\compartments\staking\ |      100 |      100 |      100 |      100 |                |
  ICurveStakingHelper.sol                                |      100 |      100 |      100 |      100 |                |
  IGLPStakingHelper.sol                                  |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\oracles\              |      100 |      100 |      100 |      100 |                |
  IDSETH.sol                                             |      100 |      100 |      100 |      100 |                |
  IOlympus.sol                                           |      100 |      100 |      100 |      100 |                |
  IUniV2.sol                                             |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\oracles\chainlink\    |      100 |      100 |      100 |      100 |                |
  AggregatorV3Interface.sol                              |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\oracles\uniswap\      |      100 |      100 |      100 |      100 |                |
  ITwapGetter.sol                                        |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\wrappers\ERC20\       |      100 |      100 |      100 |      100 |                |
  IERC20Wrapper.sol                                      |      100 |      100 |      100 |      100 |                |
  IWrappedERC20Impl.sol                                  |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\wrappers\ERC721\      |      100 |      100 |      100 |      100 |                |
  IERC721Wrapper.sol                                     |      100 |      100 |      100 |      100 |                |
  IWrappedERC721Impl.sol                                 |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\oracles\chainlink\               |      100 |    77.59 |      100 |    94.32 |                |
  ChainlinkArbitrumSequencerUSD.sol                      |      100 |       50 |      100 |    66.67 |          32,36 |
  ChainlinkBase.sol                                      |      100 |    58.33 |      100 |    93.33 |          42,94 |
  ChainlinkBasic.sol                                     |      100 |      100 |      100 |      100 |                |
  ChainlinkBasicWithWbtc.sol                             |      100 |      100 |      100 |      100 |                |
  OlympusOracle.sol                                      |      100 |      100 |      100 |      100 |                |
  UniV2Chainlink.sol                                     |      100 |       95 |      100 |    97.14 |             92 |
 contracts\peer-to-peer\oracles\uniswap\                 |    79.52 |    52.94 |    84.62 |    56.11 |                |
  FullMath.sol                                           |    41.67 |       20 |       50 |    25.81 |... 123,124,125 |
  IndexCoopOracle.sol                                    |      100 |    83.33 |      100 |    93.88 |     68,129,168 |
  TickMath.sol                                           |     69.7 |    42.59 |       50 |    35.44 |... 248,249,251 |
  TwapGetter.sol                                         |      100 |       50 |      100 |    90.48 |          52,66 |
 contracts\peer-to-peer\wrappers\ERC20\                  |      100 |       75 |      100 |    96.77 |                |
  ERC20Wrapper.sol                                       |      100 |    77.27 |      100 |    97.06 |             45 |
  WrappedERC20Impl.sol                                   |      100 |       70 |      100 |    96.43 |             61 |
 contracts\peer-to-peer\wrappers\ERC721\                 |      100 |    81.58 |      100 |    96.74 |                |
  ERC721Wrapper.sol                                      |      100 |    81.82 |      100 |    95.12 |         47,128 |
  WrappedERC721Impl.sol                                  |      100 |    81.25 |      100 |    98.04 |             95 |
 contracts\peer-to-pool\                                 |    98.34 |    90.24 |      100 |    97.46 |                |
  DataTypesPeerToPool.sol                                |      100 |      100 |      100 |      100 |                |
  Factory.sol                                            |    97.73 |    92.86 |      100 |    98.51 |             61 |
  FundingPoolImpl.sol                                    |    96.88 |    83.82 |      100 |    95.92 | 64,169,270,274 |
  LoanProposalImpl.sol                                   |    99.25 |    92.65 |      100 |    97.82 |... 255,421,456 |
 contracts\peer-to-pool\interfaces\                      |      100 |      100 |      100 |      100 |                |
  IFactory.sol                                           |      100 |      100 |      100 |      100 |                |
  IFundingPoolImpl.sol                                   |      100 |      100 |      100 |      100 |                |
  ILoanProposalImpl.sol                                  |      100 |      100 |      100 |      100 |                |
 contracts\test\                                         |    70.59 |       40 |    65.71 |    76.67 |                |
  IPAXG.sol                                              |      100 |      100 |      100 |      100 |                |
  IUSDC.sol                                              |      100 |      100 |      100 |      100 |                |
  IWETH.sol                                              |      100 |      100 |      100 |      100 |                |
  MaliciousCompartment.sol                               |       50 |      100 |    66.67 |       75 |             28 |
  MaliciousOwnerContract.sol                             |      100 |      100 |      100 |      100 |                |
  MyERC20.sol                                            |      100 |      100 |      100 |      100 |                |
  MyERC721.sol                                           |      100 |    66.67 |      100 |      100 |                |
  MyMaliciousCallback1.sol                               |    66.67 |       50 |    66.67 |    85.71 |             52 |
  MyMaliciousCallback2.sol                               |    66.67 |       50 |    66.67 |    85.71 |             39 |
  MyMaliciousERC20.sol                                   |     62.5 |       50 |       50 |       75 |       28,46,50 |
  TestnetTokenManager.sol                                |    55.56 |     12.5 |    41.67 |    55.56 |... 119,122,126 |
---------------------------------------------------------|----------|----------|----------|----------|----------------|
All files                                                |    96.26 |     83.3 |    92.86 |     91.4 |                |
---------------------------------------------------------|----------|----------|----------|----------|----------------|
```
