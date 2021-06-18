import { Account, PublicKey } from '@solana/web3.js';
import { expect } from 'chai';
import * as Test from './utils';
import { MerpsClient } from '../src';
import MerpsGroup, { QUOTE_INDEX } from '../src/MerpsGroup';
import { I80F48 } from '../src/fixednum';
import { sleep, zeroKey } from '../src/utils';
import MerpsAccount from '../src/MerpsAccount';


describe('Oracle', async () => {
  let client: MerpsClient;
  let payer: Account;
  let groupKey: PublicKey;
  let group: MerpsGroup;
  const connection = Test.createDevnetConnection();

  before(async () => {
    client = new MerpsClient(connection, Test.MerpsProgramId);
    console.log("1")
    sleep(2000); // sleeping because devnet rate limits suck
    payer = await Test.createAccount(connection);
    console.log("2")
    sleep(2000); // sleeping because devnet rate limits suck
    groupKey = await client.initMerpsGroup( Test.USDCMint, Test.DexProgramId, 5, payer);
    console.log("3")
    group = await client.getMerpsGroup(groupKey);
    console.log("4")
  });

  describe('addOracle', async () => {
    // it('defaultOracleTest', async () => {
    //   sleep(1000); // sleeping because devnet rate limits suck
    //   const productPk = new PublicKey('3m1y5h2uv7EQL3KaJZehvAJa4yDNvgc5yAdL9KPMKwvk');
    //   const pricePk = new PublicKey('HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J');
    //   // const ai = await connection.getAccountInfo(oraclePk);
    //   // if (ai){
    //   //   console.log(ai.data.byteLength);
    //   //   console.log(ai);
    //   // }
    //
    //   await client.testRalfs(
    //     productPk,
    //     pricePk,
    //     payer,
    //   )
    // });
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
      console.log("Oracle before", group.oracles[marketIndex]);
      group = await client.getMerpsGroup(groupKey);
      console.log("Oracle after", group.oracles[marketIndex]);
      console.log("=====1.====");
      await client.cachePrices(
        group.publicKey,
        group.merpsCache,
        [group.oracles[marketIndex]],
        payer,
      );
      console.log("=====2.====");
      group = await client.getMerpsGroup(groupKey);
      console.log("=====3.====");
      // console.log(group);
      // console.log(group.merpsCache);
    });
    it('should retrieve merpsCache with prices set by pyth oracle', async () => {
      sleep(1000); // sleeping because devnet rate limits suck
      const btcOraclePk = new PublicKey('HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J');
      await client.addOracle(group, btcOraclePk, payer);
      const marketIndex = 0;
      console.log("Oracle before", group.oracles[marketIndex]);
      group = await client.getMerpsGroup(groupKey);
      console.log("Oracle after", group.oracles[marketIndex]);
      console.log("=====1.====");
      await client.cachePrices(
        group.publicKey,
        group.merpsCache,
        [group.oracles[marketIndex]],
        payer,
      );
      console.log("=====2.====");
      group = await client.getMerpsGroup(groupKey);
      console.log("=====3.====");
      // console.log(group);
      // console.log(group.merpsCache);
    });
  });
});
