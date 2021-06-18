import { Account, PublicKey } from '@solana/web3.js';
import { expect } from 'chai';
import * as Test from './utils';
import { MerpsClient } from '../src';
import MerpsGroup from '../src/MerpsGroup';
import { I80F48 } from '../src/fixednum';
import { sleep } from '../src/utils';


describe('Oracle', async () => {
  let client: MerpsClient;
  let payer: Account;
  let groupKey: PublicKey;
  let group: MerpsGroup;
  const connection = Test.createDevnetConnection();

  before(async () => {
    client = new MerpsClient(connection, Test.MerpsProgramId);
    sleep(2000); // sleeping because devnet rate limits suck
    payer = await Test.createAccount(connection);
    sleep(2000); // sleeping because devnet rate limits suck
    groupKey = await client.initMerpsGroup( Test.USDCMint, Test.DexProgramId, 5, payer);
    group = await client.getMerpsGroup(groupKey);
  });

  describe('addOracle', async () => {
    it('should add a stub oracle', async () => {
      sleep(1000); // sleeping because devnet rate limits suck
      const btcOraclePk = await Test.createOracle(connection, Test.MerpsProgramId, payer);
      await client.addOracle(group, btcOraclePk, payer);
    });
    it('should add a pyth oracle', async () => {
      sleep(1000); // sleeping because devnet rate limits suck
      const btcOraclePk = new PublicKey('HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J');
      await client.addOracle(group, btcOraclePk, payer);
    });
  });
  describe('setOracle', async () => {
    it('should set_price for stub oracle', async () => {
      sleep(1000); // sleeping because devnet rate limits suck
      const btcOraclePk = await Test.createOracle(connection, Test.MerpsProgramId, payer);
      await client.addOracle(group, btcOraclePk, payer);
      await client.setOracle(group, btcOraclePk, payer, I80F48.fromNumber(40000));
    });
    it('should fail on set_price for pyth oracle', async () => {
      sleep(1000); // sleeping because devnet rate limits suck
      const btcOraclePk = new PublicKey('HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J');
      await client.addOracle(group, btcOraclePk, payer);
      try {
        await client.setOracle(group, btcOraclePk, payer, I80F48.fromNumber(40000));
        throw("Set oracle succeeded");
      } catch (error) {
        expect(error).to.not.equal("Set oracle succeeded");
      }
    });
  });
  describe('cachePricesForOracle', async () => {
    it('should retrieve merpsCache with prices set by stub oracle', async () => {
      sleep(1000); // sleeping because devnet rate limits suck
      const btcOraclePk = await Test.createOracle(connection, Test.MerpsProgramId, payer);
      await client.addOracle(group, btcOraclePk, payer);
      await client.setOracle(group, btcOraclePk, payer, I80F48.fromNumber(40000));
      const marketIndex = 0;
      group = await client.getMerpsGroup(groupKey);
      await client.cachePrices( group.publicKey, group.merpsCache, [group.oracles[marketIndex]], payer);
      group = await client.getMerpsGroup(groupKey);
    });
    it('should retrieve merpsCache with prices set by pyth oracle', async () => {
      sleep(1000); // sleeping because devnet rate limits suck
      const btcOraclePk = new PublicKey('HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J');
      await client.addOracle(group, btcOraclePk, payer);
      const marketIndex = 0;
      group = await client.getMerpsGroup(groupKey);
      await client.cachePrices( group.publicKey, group.merpsCache, [group.oracles[marketIndex]], payer);
      group = await client.getMerpsGroup(groupKey);
    });
  });
});
