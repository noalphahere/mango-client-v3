import fs from 'fs';
import os from 'os';
import {
  Cluster,
  Config,
  MangoClient,
  MAX_PAIRS,
  sleep,
  throwUndefined,
  MAX_NUM_IN_MARGIN_BASKET,
  QUOTE_INDEX,
  MAX_PERP_OPEN_ORDERS,
} from '../src';
import configFile from '../src/ids.json';
import { Account, Commitment, Connection } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { expect } from 'chai';



describe('Perps', async () => {
  const groupName = process.env.GROUP || 'devnet.2';
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 500;
  const config = new Config(configFile);
  const groupIds = config.getGroup(cluster, groupName);
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }
  const mangoProgramId = groupIds.mangoProgramId;
  const mangoGroupKey = groupIds.publicKey;
  const payer = new Account(
    JSON.parse(
      process.env.KEYPAIR ||
        fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
    ),
  );

  const connection = new Connection(
    config.cluster_urls[cluster],
    'processed' as Commitment,
  );

  it('testCancelAllPerpOrders', async () => {
    console.log("Testing perps");
    const client = new MangoClient(connection, mangoProgramId);
    const mangoGroup = await client.getMangoGroup(mangoGroupKey);
    const rootBanks = await mangoGroup.loadRootBanks(connection);
    const quoteRootBank = rootBanks[QUOTE_INDEX];
    if (!quoteRootBank) {
      throw new Error();
    }
    const quoteNodeBanks = await quoteRootBank.loadNodeBanks(connection);
    const marketIndex = 1;
    const perpMarket = await client.getPerpMarket(
      mangoGroup.perpMarkets[marketIndex].perpMarket,
      groupIds.perpMarkets[0].baseDecimals,
      groupIds.perpMarkets[0].quoteDecimals,
    );

    const mangoAccountPk = await client.initMangoAccount(mangoGroup, payer);
    const mangoAccount = await client.getMangoAccount(
        mangoAccountPk,
        mangoGroup.dexProgramId,
    );
    const tokenConfig = groupIds.tokens[QUOTE_INDEX];
    const tokenInfo = mangoGroup.tokens[QUOTE_INDEX];
    const token = new Token(
      connection,
      tokenInfo.mint,
      TOKEN_PROGRAM_ID,
      payer,
    );
    const wallet = await token.getOrCreateAssociatedAccountInfo(
      payer.publicKey,
    );
    await client.deposit(
      mangoGroup,
      mangoAccount,
      payer,
      quoteRootBank.publicKey,
      quoteNodeBanks[0].publicKey,
      quoteNodeBanks[0].vault,
      wallet.address,
      1_000_000,
    );

    await sleep(sleepTime);

    for (let i = 0; i < MAX_PERP_OPEN_ORDERS; i++) {
      await sleep(sleepTime);
      await client.placePerpOrder(
        mangoGroup,
        mangoAccount,
        mangoGroup.mangoCache,
        perpMarket,
        payer,
        'buy',
        10000,
        1,
        'limit',
      );
    }

    await mangoAccount.reload(connection);
    for (let orderMarket of mangoAccount.orderMarket) {
        expect(orderMarket).to.eq(marketIndex);
    }

    await client.cancelAllPerpOrders(
      mangoGroup,
      mangoAccount,
      payer,
      perpMarket,
      new BN(255),
    );

    await mangoAccount.reload(connection);
    for (let orderMarket of mangoAccount.orderMarket) {
        expect(orderMarket).to.eq(255);
    }

  });
})
