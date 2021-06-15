import {
  Account,
  Connection,
  PublicKey,
  SimulatedTransactionResponse,
  Transaction,
  TransactionConfirmationStatus,
  TransactionSignature,
  TransactionInstruction,
  // AccountInfo,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import BN from 'bn.js';
import {
  awaitTransactionSignatureConfirmation,
  simulateTransaction,
  sleep,
  createAccountInstruction,
  createSignerKeyAndNonce,
  createTokenAccountInstructions,
  nativeToUi,
  uiToNative,
  zeroKey,
} from './utils';
import {
  MerpsGroupLayout,
  encodeMerpsInstruction,
  NodeBankLayout,
  RootBankLayout,
  MerpsCacheLayout,
  MerpsAccountLayout,
  RootBank,
} from './layout';
import MerpsGroup, { QUOTE_INDEX } from './MerpsGroup';
import MerpsAccount from './MerpsAccount';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  makeAddSpotMarketInstruction,
  makeAddToBasketInstruction,
  makeCachePricesInstruction,
  makeCacheRootBankInstruction,
  makeCancelOrderInstruction,
  makeDepositInstruction,
  makeInitMerpsAccountInstruction,
  makeInitMerpsGroupInstruction,
  makeSettleFundsInstruction,
  makeWithdrawInstruction,
} from './instruction';
import {
  Market,
  getFeeRates,
  getFeeTier,
  OpenOrders,
} from '@project-serum/serum';
import { I80F48 } from './fixednum';
import { Order } from '@project-serum/serum/lib/market';

export const getUnixTs = () => {
  return new Date().getTime() / 1000;
};

export class MerpsClient {
  connection: Connection;
  programId: PublicKey;

  constructor(connection: Connection, programId: PublicKey) {
    this.connection = connection;
    this.programId = programId;
  }

  async sendTransactions(
    transactions: Transaction[],
    payer: Account,
    additionalSigners: Account[],
    timeout = 30000,
    confirmLevel: TransactionConfirmationStatus = 'confirmed',
  ): Promise<TransactionSignature[]> {
    return await Promise.all(
      transactions.map((tx) =>
        this.sendTransaction(
          tx,
          payer,
          additionalSigners,
          timeout,
          confirmLevel,
        ),
      ),
    );
  }

  async sendTransaction(
    transaction: Transaction,
    payer: Account,
    additionalSigners: Account[],
    timeout = 30000,
    confirmLevel: TransactionConfirmationStatus = 'confirmed',
  ): Promise<TransactionSignature> {
    transaction.recentBlockhash = (
      await this.connection.getRecentBlockhash('singleGossip')
    ).blockhash;
    transaction.setSigners(
      payer.publicKey,
      ...additionalSigners.map((a) => a.publicKey),
    );

    const signers = [payer].concat(additionalSigners);
    transaction.sign(...signers);
    const rawTransaction = transaction.serialize();
    const startTime = getUnixTs();

    const txid: TransactionSignature = await this.connection.sendRawTransaction(
      rawTransaction,
      { skipPreflight: true },
    );

    console.log('Started awaiting confirmation for', txid);
    let done = false;
    (async () => {
      while (!done && getUnixTs() - startTime < timeout / 1000) {
        this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
        });
        await sleep(300);
      }
    })();

    try {
      await awaitTransactionSignatureConfirmation(
        txid,
        timeout,
        this.connection,
        confirmLevel,
      );
    } catch (err) {
      if (err.timeout) {
        throw new Error('Timed out awaiting confirmation on transaction');
      }
      let simulateResult: SimulatedTransactionResponse | null = null;
      try {
        simulateResult = (
          await simulateTransaction(
            this.connection,
            transaction,
            'singleGossip',
          )
        ).value;
      } catch (e) {
        console.warn('Simulate transaction failed');
      }

      if (simulateResult && simulateResult.err) {
        if (simulateResult.logs) {
          for (let i = simulateResult.logs.length - 1; i >= 0; --i) {
            const line = simulateResult.logs[i];
            if (line.startsWith('Program log: ')) {
              throw new Error(
                'Transaction failed: ' + line.slice('Program log: '.length),
              );
            }
          }
        }
        throw new Error(JSON.stringify(simulateResult.err));
      }
      throw new Error('Transaction failed');
    } finally {
      done = true;
    }

    console.log('Latency', txid, getUnixTs() - startTime);
    return txid;
  }

  async initMerpsGroup(
    payer: Account,
    quoteMint: PublicKey,
    dexProgram: PublicKey,
    validInterval: number,
  ): Promise<PublicKey> {
    const accountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      MerpsGroupLayout.span,
      this.programId,
    );
    const { signerKey, signerNonce } = await createSignerKeyAndNonce(
      this.programId,
      accountInstruction.account.publicKey,
    );
    const quoteVaultAccount = new Account();

    const quoteVaultAccountInstructions = await createTokenAccountInstructions(
      this.connection,
      payer.publicKey,
      quoteVaultAccount.publicKey,
      quoteMint,
      signerKey,
    );

    const quoteNodeBankAccountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      NodeBankLayout.span,
      this.programId,
    );
    const quoteRootBankAccountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      RootBankLayout.span,
      this.programId,
    );
    const cacheAccountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      MerpsCacheLayout.span,
      this.programId,
    );

    const initMerpsGroupInstruction = makeInitMerpsGroupInstruction(
      this.programId,
      accountInstruction.account.publicKey,
      signerKey,
      payer.publicKey,
      quoteMint,
      quoteVaultAccount.publicKey,
      quoteNodeBankAccountInstruction.account.publicKey,
      quoteRootBankAccountInstruction.account.publicKey,
      cacheAccountInstruction.account.publicKey,
      dexProgram,
      signerNonce,
      validInterval,
    );

    const transaction = new Transaction();
    transaction.add(accountInstruction.instruction);
    transaction.add(...quoteVaultAccountInstructions);
    transaction.add(quoteNodeBankAccountInstruction.instruction);
    transaction.add(quoteRootBankAccountInstruction.instruction);
    transaction.add(cacheAccountInstruction.instruction);
    transaction.add(initMerpsGroupInstruction);

    await this.sendTransaction(transaction, payer, [
      accountInstruction.account,
      quoteVaultAccount,
      quoteNodeBankAccountInstruction.account,
      quoteRootBankAccountInstruction.account,
      cacheAccountInstruction.account,
    ]);

    return accountInstruction.account.publicKey;
  }

  async getMerpsGroup(merpsGroup: PublicKey): Promise<MerpsGroup> {
    const accountInfo = await this.connection.getAccountInfo(merpsGroup);
    const decoded = MerpsGroupLayout.decode(
      accountInfo == null ? undefined : accountInfo.data,
    );

    return new MerpsGroup(merpsGroup, decoded);
  }

  async initMerpsAccount(
    merpsGroup: MerpsGroup,
    owner: Account,
  ): Promise<PublicKey> {
    const accountInstruction = await createAccountInstruction(
      this.connection,
      owner.publicKey,
      MerpsAccountLayout.span,
      this.programId,
    );

    const initMerpsAccountInstruction = makeInitMerpsAccountInstruction(
      this.programId,
      merpsGroup.publicKey,
      accountInstruction.account.publicKey,
      owner.publicKey,
    );

    // Add all instructions to one atomic transaction
    const transaction = new Transaction();
    transaction.add(accountInstruction.instruction);
    transaction.add(initMerpsAccountInstruction);

    const additionalSigners = [accountInstruction.account];
    await this.sendTransaction(transaction, owner, additionalSigners);

    return accountInstruction.account.publicKey;
  }

  async getMerpsAccount(
    merpsAccountPk: PublicKey,
    dexProgramId: PublicKey,
  ): Promise<MerpsAccount> {
    const acc = await this.connection.getAccountInfo(
      merpsAccountPk,
      'singleGossip',
    );
    const merpsAccount = new MerpsAccount(
      merpsAccountPk,
      MerpsAccountLayout.decode(acc == null ? undefined : acc.data),
    );
    await merpsAccount.loadOpenOrders(this.connection, dexProgramId);
    return merpsAccount;
  }

  async deposit(
    merpsGroup: MerpsGroup,
    merpsAccount: MerpsAccount,
    owner: Account,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,
    tokenAcc: PublicKey,

    quantity: number,
  ): Promise<TransactionSignature> {
    const tokenIndex = merpsGroup.getRootBankIndex(rootBank);
    const nativeQuantity = uiToNative(
      quantity,
      merpsGroup.tokens[tokenIndex].decimals,
    );

    const instruction = makeDepositInstruction(
      this.programId,
      merpsGroup.publicKey,
      owner.publicKey,
      merpsAccount.publicKey,
      rootBank,
      nodeBank,
      vault,
      tokenAcc,
      nativeQuantity,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async withdraw(
    merpsGroup: MerpsGroup,
    merpsAccount: MerpsAccount,
    owner: Account,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,
    tokenAcc: PublicKey,

    quantity: number,
    allowBorrow: boolean,
  ): Promise<TransactionSignature> {
    const tokenIndex = merpsGroup.getRootBankIndex(rootBank);
    const nativeQuantity = uiToNative(
      quantity,
      merpsGroup.tokens[tokenIndex].decimals,
    );

    const instruction = makeWithdrawInstruction(
      this.programId,
      merpsGroup.publicKey,
      merpsAccount.publicKey,
      owner.publicKey,
      merpsGroup.merpsCache,
      rootBank,
      nodeBank,
      vault,
      tokenAcc,
      merpsGroup.signerKey,
      merpsAccount.spotOpenOrders,
      nativeQuantity,
      allowBorrow,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  // Keeper functions
  async cacheRootBanks(
    payer: Account,
    merpsGroup: PublicKey,
    merpsCache: PublicKey,
    rootBanks: PublicKey[],
  ): Promise<TransactionSignature> {
    const cacheRootBanksInstruction = makeCacheRootBankInstruction(
      this.programId,
      merpsGroup,
      merpsCache,
      rootBanks,
    );

    const transaction = new Transaction();
    transaction.add(cacheRootBanksInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async cachePrices(
    merpsGroup: PublicKey,
    merpsCache: PublicKey,
    oracles: PublicKey[],
    payer: Account,
  ): Promise<TransactionSignature> {
    const cachePricesInstruction = makeCachePricesInstruction(
      this.programId,
      merpsGroup,
      merpsCache,
      oracles,
    );

    const transaction = new Transaction();
    transaction.add(cachePricesInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async updateRootBanks(
    merpsGroup: PublicKey,
    rootBank: PublicKey,
    nodeBanks: PublicKey[],
    payer: Account,
  ): Promise<TransactionSignature> {
    const keys = [
      { isSigner: false, isWritable: false, pubkey: merpsGroup },
      { isSigner: false, isWritable: true, pubkey: rootBank },
      ...nodeBanks.map((pubkey) => ({
        isSigner: false,
        isWritable: true,
        pubkey,
      })),
    ];

    const data = encodeMerpsInstruction({
      UpdateRootBank: {},
    });

    const updateRootBanksInstruction = new TransactionInstruction({
      keys,
      data,
      programId: this.programId,
    });

    const transaction = new Transaction();
    transaction.add(updateRootBanksInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async placePerpOrder(): Promise<TransactionSignature[]> {
    throw new Error('Not Implemented');
  }

  async cancelPerpOrder(): Promise<TransactionSignature[]> {
    throw new Error('Not Implemented');
  }

  async loadRootBanks(rootBanks: PublicKey[]): Promise<RootBank[]> {
    const accounts = await Promise.all(
      rootBanks.map((pk) => this.connection.getAccountInfo(pk)),
    );

    const parsedRootBanks: RootBank[] = [];

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      if (acc) {
        const decoded = RootBankLayout.decode(acc.data);
        parsedRootBanks.push(new RootBank(rootBanks[i], decoded));
      }
    }

    return parsedRootBanks;
  }

  async addOracle(
    merpsGroup: MerpsGroup,
    oracle: PublicKey,
    admin: Account,
  ): Promise<TransactionSignature> {
    const keys = [
      { isSigner: false, isWritable: true, pubkey: merpsGroup.publicKey },
      { isSigner: false, isWritable: false, pubkey: oracle },
      { isSigner: true, isWritable: false, pubkey: admin.publicKey },
    ];
    const data = encodeMerpsInstruction({ AddOracle: {} });

    const instruction = new TransactionInstruction({
      keys,
      data,
      programId: this.programId,
    });

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async addSpotMarket(
    merpsGroup: MerpsGroup,
    spotMarket: PublicKey,
    mint: PublicKey,
    admin: Account,

    marketIndex: number,
    maintLeverage: I80F48,
    initLeverage: I80F48,
  ): Promise<TransactionSignature> {
    const vaultAccount = new Account();

    const vaultAccountInstructions = await createTokenAccountInstructions(
      this.connection,
      admin.publicKey,
      vaultAccount.publicKey,
      mint,
      merpsGroup.signerKey,
    );

    const nodeBankAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      NodeBankLayout.span,
      this.programId,
    );
    const rootBankAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      RootBankLayout.span,
      this.programId,
    );

    const instruction = makeAddSpotMarketInstruction(
      this.programId,
      merpsGroup.publicKey,
      spotMarket,
      merpsGroup.dexProgramId,
      mint,
      nodeBankAccountInstruction.account.publicKey,
      vaultAccount.publicKey,
      rootBankAccountInstruction.account.publicKey,
      admin.publicKey,
      marketIndex,
      maintLeverage,
      initLeverage,
    );

    const transaction = new Transaction();
    transaction.add(...vaultAccountInstructions);
    transaction.add(nodeBankAccountInstruction.instruction);
    transaction.add(rootBankAccountInstruction.instruction);
    transaction.add(instruction);

    const additionalSigners = [
      vaultAccount,
      nodeBankAccountInstruction.account,
      rootBankAccountInstruction.account,
    ];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async addToBasket(
    merpsGroup: MerpsGroup,
    merpsAccount: MerpsAccount,
    owner: Account,

    marketIndex: number,
  ): Promise<TransactionSignature> {
    const instruction = makeAddToBasketInstruction(
      this.programId,
      merpsGroup.publicKey,
      merpsAccount.publicKey,
      owner.publicKey,
      marketIndex,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async placeSpotOrder(
    merpsGroup: MerpsGroup,
    merpsAccount: MerpsAccount,
    merpsCache: PublicKey,
    spotMarket: Market,
    owner: Account,

    side: 'buy' | 'sell',
    price: number,
    size: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
  ): Promise<TransactionSignature> {
    const limitPrice = spotMarket.priceNumberToLots(price);
    const maxBaseQuantity = spotMarket.baseSizeNumberToLots(size);

    // TODO implement srm vault fee discount
    // const feeTier = getFeeTier(0, nativeToUi(merpsGroup.nativeSrm || 0, SRM_DECIMALS));
    const feeTier = getFeeTier(0, nativeToUi(0, 0));
    const rates = getFeeRates(feeTier);
    const maxQuoteQuantity = new BN(
      spotMarket['_decoded'].quoteLotSize.toNumber() * (1 + rates.taker),
    ).mul(
      spotMarket
        .baseSizeNumberToLots(size)
        .mul(spotMarket.priceNumberToLots(price)),
    );

    if (maxBaseQuantity.lte(new BN(0))) {
      throw new Error('size too small');
    }
    if (limitPrice.lte(new BN(0))) {
      throw new Error('invalid price');
    }
    const selfTradeBehavior = 'decrementTake';

    const spotMarketIndex = merpsGroup.getSpotMarketIndex(spotMarket);

    const { baseRootBank, baseNodeBank, quoteRootBank, quoteNodeBank } =
      await merpsGroup.loadBanksForSpotMarket(this.connection, spotMarketIndex);

    const transaction = new Transaction();
    const additionalSigners: Account[] = [];

    const openOrdersKeys: PublicKey[] = [];
    for (let i = 0; i < merpsAccount.spotOpenOrders.length; i++) {
      if (!merpsAccount.inBasket[i]) {
        continue;
      }
      if (
        i === spotMarketIndex &&
        merpsAccount.spotOpenOrders[spotMarketIndex].equals(zeroKey)
      ) {
        // open orders missing for this market; create a new one now
        const openOrdersSpace = OpenOrders.getLayout(
          merpsGroup.dexProgramId,
        ).span;
        const openOrdersLamports =
          await this.connection.getMinimumBalanceForRentExemption(
            openOrdersSpace,
            'singleGossip',
          );
        const accInstr = await createAccountInstruction(
          this.connection,
          owner.publicKey,
          openOrdersSpace,
          merpsGroup.dexProgramId,
          openOrdersLamports,
        );

        transaction.add(accInstr.instruction);
        additionalSigners.push(accInstr.account);
        openOrdersKeys.push(accInstr.account.publicKey);
      } else {
        openOrdersKeys.push(merpsAccount.spotOpenOrders[i]);
      }
    }

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const keys = [
      { isSigner: false, isWritable: false, pubkey: merpsGroup.publicKey },
      { isSigner: false, isWritable: true, pubkey: merpsAccount.publicKey },
      { isSigner: true, isWritable: false, pubkey: owner.publicKey },
      { isSigner: false, isWritable: false, pubkey: merpsCache },
      { isSigner: false, isWritable: false, pubkey: spotMarket.programId },
      { isSigner: false, isWritable: true, pubkey: spotMarket.publicKey },
      {
        isSigner: false,
        isWritable: true,
        pubkey: spotMarket['_decoded'].bids,
      },
      {
        isSigner: false,
        isWritable: true,
        pubkey: spotMarket['_decoded'].asks,
      },
      {
        isSigner: false,
        isWritable: true,
        pubkey: spotMarket['_decoded'].requestQueue,
      },
      {
        isSigner: false,
        isWritable: true,
        pubkey: spotMarket['_decoded'].eventQueue,
      },
      {
        isSigner: false,
        isWritable: true,
        pubkey: spotMarket['_decoded'].baseVault,
      },
      {
        isSigner: false,
        isWritable: true,
        pubkey: spotMarket['_decoded'].quoteVault,
      },
      { isSigner: false, isWritable: false, pubkey: baseRootBank?.publicKey },
      { isSigner: false, isWritable: true, pubkey: baseNodeBank?.publicKey },
      { isSigner: false, isWritable: true, pubkey: quoteRootBank?.publicKey },
      { isSigner: false, isWritable: true, pubkey: quoteNodeBank?.publicKey },
      { isSigner: false, isWritable: true, pubkey: quoteNodeBank?.vault },
      { isSigner: false, isWritable: true, pubkey: baseNodeBank?.vault },
      { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
      { isSigner: false, isWritable: false, pubkey: merpsGroup.signerKey },
      { isSigner: false, isWritable: false, pubkey: SYSVAR_RENT_PUBKEY },
      { isSigner: false, isWritable: false, pubkey: dexSigner },
      ...openOrdersKeys.map((pubkey) => ({
        isSigner: false,
        isWritable: true,
        pubkey,
      })),
    ];

    const data = encodeMerpsInstruction({
      PlaceSpotOrder: {
        side,
        limitPrice,
        maxBaseQuantity,
        maxQuoteQuantity,
        selfTradeBehavior,
        orderType,
        limit: 65535,
      },
    });

    const placeOrderInstruction = new TransactionInstruction({
      keys,
      data,
      programId: this.programId,
    });
    transaction.add(placeOrderInstruction);

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async cancelSpotOrder(
    merpsGroup: MerpsGroup,
    merpsAccount: MerpsAccount,
    owner: Account,
    spotMarket: Market,
    order: Order,
  ): Promise<TransactionSignature> {
    const instruction = makeCancelOrderInstruction(
      this.programId,
      merpsGroup.publicKey,
      owner.publicKey,
      merpsAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      order.openOrdersAddress,
      merpsGroup.signerKey,
      spotMarket['_decoded'].eventQueue,
      order,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async settleFunds(
    merpsGroup: MerpsGroup,
    merpsAccount: MerpsAccount,
    owner: Account,
    spotMarket: Market,
  ): Promise<TransactionSignature> {
    const marketIndex = merpsGroup.getSpotMarketIndex(spotMarket);
    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const { baseNodeBank, quoteNodeBank } =
      await merpsGroup.loadBanksForSpotMarket(this.connection, marketIndex);

    if (!baseNodeBank || !quoteNodeBank) {
      throw new Error('Invalid or missing node banks');
    }

    const instruction = makeSettleFundsInstruction(
      this.programId,
      merpsGroup.publicKey,
      owner.publicKey,
      merpsAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      merpsAccount.spotOpenOrders[marketIndex],
      merpsGroup.signerKey,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      merpsGroup.tokens[marketIndex].rootBank,
      baseNodeBank.publicKey,
      merpsGroup.tokens[QUOTE_INDEX].rootBank,
      quoteNodeBank.publicKey,
      baseNodeBank.vault,
      quoteNodeBank.vault,
      dexSigner,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, owner, additionalSigners);
  }
}
